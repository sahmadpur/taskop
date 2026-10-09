import { requirements } from '@taskop/contracts';
import type { ContentLoad } from './content';
import { setMeta } from './db';
import { ExecutionLockedError, LiveOnlyError, MediaLimitError, mediaRegisterBody, type StartBlock, startBlock } from './execution-store';
import type { LocalOccurrence } from './local-model';
import { capturedPhoto, capturedVideo } from './testing/fake-transport';
import { DEVICE, ME, OCC, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION, VERSION2, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';
import { failingDriver, nodeDriver, openTestDb } from './testing/node-db';

const outbox = (h: Harness) => h.db.all<{ kind: string; rev: number | null; ref_id: string | null; payload: string }>('SELECT kind, rev, ref_id, payload FROM outbox ORDER BY seq');
const kinds = async (h: Harness) => (await outbox(h)).map((c) => c.kind);
const payload = async (h: Harness, kind: string) => JSON.parse((await outbox(h)).filter((c) => c.kind === kind).at(-1)!.payload);

async function started(o: { at?: string } = {}) {
  const h = await createHarness(o);
  const id = await h.store.start(OCC, ME);
  return { h, id };
}

async function answerEverything(h: Harness, id: string) {
  await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
  await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
  await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
}

describe('startBlock', () => {
  const base: LocalOccurrence = {
    id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
    startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'pending', checklistVersionId: VERSION, claim: null,
  };
  const claimedBy = (userId: string) => ({ ...base, claim: { executionId: OTHER_EXECUTION, executorUserId: userId, executorName: 'Murad' } });
  const ahead = 2 * 60_000 + 1;
  it.each<[string, LocalOccurrence, string, ContentLoad['kind'], number, StartBlock | null]>([
    ['open and mine', base, T.open, 'ok', 0, null],
    ['before the window', base, T.before, 'ok', 0, 'notYetOpen'],
    ['one millisecond before closes_at', base, '2026-11-02T06:59:59.999Z', 'ok', 0, null],
    ['at closes_at', base, T.closes, 'ok', 0, 'closed'],
    ['claimed by someone else', claimedBy(OTHER), T.open, 'ok', 0, 'claimedByOther'],
    ['claimed by me on another install (no local execution here)', claimedBy(ME), T.open, 'ok', 0, 'claimedByOther'],
    ['already completed', { ...base, status: 'completed' }, T.open, 'ok', 0, 'finished'],
    ['content not downloaded yet', base, T.open, 'missing', 0, 'notDownloaded'],
    ['content newer than the app', base, T.open, 'needsUpdate', 0, 'needsUpdate'],
    ['phone clock too far ahead of the server', base, T.open, 'ok', ahead, 'clockAhead'],
    ['phone clock ahead within the tolerance', base, T.open, 'ok', ahead - 1, null],
  ])('%s', (_name, o, now, content, offsetMs, expected) => {
    expect(startBlock(o, ME, Date.parse(now), content, offsetMs)).toBe(expected);
  });
});

describe('starting', () => {
  it('writes the execution and its claim command in one go and asks for an immediate sync', async () => {
    const { h, id } = await started();
    expect(await h.store.execution(id)).toMatchObject({ occurrenceId: OCC, state: 'active', claim: 'pending', startedAt: T.open, rev: 0, answers: {} });
    expect(await kinds(h)).toEqual(['claim']);
    expect(await payload(h, 'claim')).toEqual({ id, occurrenceId: OCC, startedAt: T.open, device: DEVICE });
    expect(h.writes).toEqual(['claim']);
    expect((await h.store.occurrences())[0]).toMatchObject({ id: OCC, execution: { id } });
  });

  it('resumes instead of claiming twice on a double tap', async () => {
    const { h, id } = await started();
    expect(await h.store.start(OCC, ME)).toBe(id);
    expect(await kinds(h)).toEqual(['claim']);
  });

  it('refuses before the window opens and for a checklist version newer than the app understands', async () => {
    const h = await createHarness({ at: T.before });
    await expect(h.store.start(OCC, ME)).rejects.toMatchObject({ reason: 'notYetOpen' });
    h.clock.set(T.open);
    await h.seed(syncResponse({ occurrences: [occurrence({ checklistVersionId: VERSION2 })], checklistVersions: [versionOf({ schemaVersion: 2 }, VERSION2, 2)] }));
    await expect(h.store.start(OCC, ME)).rejects.toMatchObject({ reason: 'needsUpdate' });
    expect(await h.store.content(VERSION2)).toEqual({ kind: 'needsUpdate' });
    expect(await kinds(h)).toEqual([]);
  });

  it('refuses while the phone clock runs too far ahead of the server, and when another install of mine holds the claim', async () => {
    const h = await createHarness();
    await setMeta(h.db, 'clockOffsetMs', String(3 * 60_000));
    await expect(h.store.start(OCC, ME)).rejects.toMatchObject({ reason: 'clockAhead' });
    await setMeta(h.db, 'clockOffsetMs', '0');
    await h.seed(syncResponse({ occurrences: [occurrence({ claim: { executionId: OTHER_EXECUTION, executorUserId: ME, executorName: 'Mən' } })] }));
    await expect(h.store.start(OCC, ME)).rejects.toMatchObject({ reason: 'claimedByOther' });
    expect(await kinds(h)).toEqual([]);
    expect(h.writes).toEqual([]);
  });
});

describe('answering', () => {
  it('appends one answers command per change and keeps only the latest revision queued', async () => {
    const { h, id } = await started();
    await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 4 });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    const answers = { [h.c.problem.id]: { optionIds: [h.c.no.id] }, [h.c.temp.id]: { number: 5 } };
    expect(await h.store.execution(id)).toMatchObject({ rev: 3, answers });
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['claim', null], ['answers', 3]]);
    expect(await payload(h, 'answers')).toEqual({ rev: 3, answers });
    expect(h.writes).toEqual(['claim', 'change', 'change', 'change']);
    expect(await h.store.unsyncedCount()).toBe(2);
  });

  it('drops cleared fields and empty answers', async () => {
    const { h, id } = await started();
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5, note: 'x' });
    await h.store.patchAnswer(id, h.c.temp.id, { number: undefined, note: '' });
    expect((await h.store.execution(id))!.answers).toEqual({});
  });
});

describe('media', () => {
  it('queues the registration before the answers command that references the medium', async () => {
    const { h, id } = await started();
    const photo = capturedPhoto(h.transport);
    const mediaId = await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
    expect((await outbox(h)).map((c) => [c.kind, c.ref_id])).toEqual([['claim', null], ['media', mediaId], ['answers', null]]);
    expect(await payload(h, 'media')).toEqual({
      id: mediaId, itemId: h.c.photo.id, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 250_000, width: 1600, height: 1200, durationMs: null, capturedAt: T.open,
    });
    expect((await payload(h, 'answers')).answers).toEqual({ [h.c.photo.id]: { photos: [mediaId] } });
    expect(await h.store.media(id)).toMatchObject([{ id: mediaId, localUri: photo.localUri, registeredAt: null, uploadedAt: null }]);
  });

  it('binds evidence media to its item and problem-only media to no item, with one register body for both', async () => {
    const { h, id } = await started();
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.temp.id, field: 'problem' });
    const bodies = (await outbox(h)).filter((c) => c.kind === 'media').map((c) => JSON.parse(c.payload));
    expect(bodies.map((b) => b.itemId)).toEqual([h.c.photo.id, null]);
    const rows = await h.store.media(id);
    expect(rows.map((m) => m.itemId)).toEqual([h.c.photo.id, null]);
    expect(rows.map(mediaRegisterBody)).toEqual(bodies);
  });

  it('refuses gallery media on a live-only item and media beyond what the item allows', async () => {
    const { h, id } = await started();
    const evidence = { itemId: h.c.photo.id, field: 'evidence' } as const;
    await expect(h.store.attachMedia(id, capturedPhoto(h.transport, { source: 'gallery' }), evidence)).rejects.toBeInstanceOf(LiveOnlyError);
    await h.store.attachMedia(id, capturedPhoto(h.transport), evidence);
    await h.store.attachMedia(id, capturedPhoto(h.transport), evidence);
    await expect(h.store.attachMedia(id, capturedPhoto(h.transport), evidence)).rejects.toBeInstanceOf(MediaLimitError);
    await expect(h.store.attachMedia(id, capturedVideo(h.transport), { itemId: h.c.note.id, field: 'evidence' })).rejects.toBeInstanceOf(MediaLimitError);
    expect(await h.store.media(id)).toHaveLength(2);
  });

  it('keeps problem media out of the answers until the problem is saved', async () => {
    const { h, id } = await started();
    const mediaId = await h.store.attachMedia(id, capturedVideo(h.transport), { itemId: h.c.temp.id, field: 'problem' });
    expect(await kinds(h)).toEqual(['claim', 'media']);
    expect((await payload(h, 'media')).itemId).toBeNull();
    await h.store.setProblem(id, h.c.temp.id, { severity: 'critical', note: '  Termometr sınıb ', mediaIds: [mediaId] });
    expect((await h.store.execution(id))!.answers).toEqual({ [h.c.temp.id]: { problem: { severity: 'critical', note: 'Termometr sınıb', mediaIds: [mediaId] } } });
    await expect(h.store.setProblem(id, h.c.temp.id, { severity: 'normal', note: '   ', mediaIds: [] })).rejects.toBeInstanceOf(RangeError);
    await h.store.setProblem(id, h.c.temp.id, null);
    expect((await h.store.execution(id))!.answers).toEqual({});
  });

  it('never sends a medium twice in a problem or in the evidence', async () => {
    const { h, id } = await started();
    const mediaId = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.temp.id, field: 'problem' });
    await h.store.setProblem(id, h.c.temp.id, { severity: 'normal', note: 'Sınıb', mediaIds: [mediaId, mediaId] });
    const evidenceId = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(id, h.c.photo.id, { photos: [evidenceId, evidenceId] });
    expect((await h.store.execution(id))!.answers).toEqual({
      [h.c.temp.id]: { problem: { severity: 'normal', note: 'Sınıb', mediaIds: [mediaId] } },
      [h.c.photo.id]: { photos: [evidenceId] },
    });
    const sixTimesOne = Array.from({ length: 6 }, () => mediaId);
    await expect(h.store.setProblem(id, h.c.temp.id, { severity: 'normal', note: 'x', mediaIds: sixTimesOne })).resolves.toBeUndefined();
  });

  it('forgets a medium completely when it is removed before registration', async () => {
    const { h, id } = await started();
    const photo = capturedPhoto(h.transport);
    const mediaId = await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.removeMedia(id, mediaId);
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['claim', null], ['answers', 2]]);
    expect((await payload(h, 'answers')).answers).toEqual({});
    expect(await h.store.media(id)).toEqual([]);
    expect(h.transport.removed).toEqual([photo.localUri]);
  });
});

describe('completing', () => {
  it('lists what is missing, then completes with the full answers once everything is there', async () => {
    const { h, id } = await started();
    expect(await h.store.complete(id)).toEqual({ ok: false, missing: requirements(h.c.content, {}) });
    await answerEverything(h, id);
    h.clock.set('2026-11-02T05:00:00.000Z');
    expect(await h.store.complete(id)).toEqual({ ok: true });
    const e = (await h.store.execution(id))!;
    expect(e).toMatchObject({ state: 'completed', completedAt: '2026-11-02T05:00:00.000Z', rev: 3 });
    expect(await kinds(h)).toEqual(['claim', 'media', 'answers', 'complete']);
    expect(await payload(h, 'complete')).toEqual({ rev: 3, answers: e.answers, completedAt: '2026-11-02T05:00:00.000Z' });
    await expect(h.store.patchAnswer(id, h.c.note.id, { text: 'gec' })).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await h.store.problemCount([id])).toBe(0);
  });
});

describe('the device clock', () => {
  it('locks at closes_at and stays locked when the clock is moved back', async () => {
    const { h, id } = await started();
    h.clock.set(T.closes);
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 5 })).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await h.store.execution(id)).toMatchObject({ state: 'partial', lockedAt: T.closes, rev: 0 });
    h.clock.set(T.open);
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 5 })).rejects.toMatchObject({ state: 'partial' });
    await expect(h.store.complete(id)).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await kinds(h)).toEqual(['claim']);
  });

  it('still takes answers and a completion one millisecond before closes_at', async () => {
    const { h, id } = await started();
    await answerEverything(h, id);
    h.clock.set('2026-11-02T06:59:59.999Z');
    await h.store.patchAnswer(id, h.c.note.id, { text: 'son' });
    expect(await h.store.complete(id)).toEqual({ ok: true });
    expect(await h.store.execution(id)).toMatchObject({ state: 'completed', completedAt: '2026-11-02T06:59:59.999Z' });
  });

  it('refuses a completion at closes_at', async () => {
    const { h, id } = await started();
    await answerEverything(h, id);
    h.clock.set(T.closes);
    await expect(h.store.complete(id)).rejects.toMatchObject({ state: 'partial' });
    expect(await kinds(h)).toEqual(['claim', 'media', 'answers']);
  });

  it('locks every open execution past closes_at in one sweep', async () => {
    const { h, id } = await started();
    h.clock.set('2026-11-02T07:00:01.000Z');
    expect(await h.store.lockExpired()).toBe(1);
    expect(await h.store.execution(id)).toMatchObject({ state: 'partial' });
    expect(await h.store.lockExpired()).toBe(0);
  });

  it('never completes before it started when the clock moved backwards', async () => {
    const { h, id } = await started();
    await answerEverything(h, id);
    h.clock.set('2026-11-02T04:05:00.000Z');
    expect(await h.store.complete(id)).toEqual({ ok: true });
    expect((await h.store.execution(id))!.completedAt).toBe(T.open);
  });
});

describe('atomic actions', () => {
  it('rolls the answer back when the outbox append fails (app killed between the two writes)', async () => {
    const driver = failingDriver(nodeDriver(), /INSERT INTO outbox/);
    const h = await createHarness({ db: await openTestDb(driver) });
    const id = await h.store.start(OCC, ME);
    driver.armed = true;
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 5 })).rejects.toThrow('simulated crash');
    await expect(h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' })).rejects.toThrow('simulated crash');
    driver.armed = false;
    expect(await h.store.execution(id)).toMatchObject({ rev: 0, answers: {} });
    expect(await h.store.media(id)).toEqual([]);
    expect(await kinds(h)).toEqual(['claim']);
  });
});

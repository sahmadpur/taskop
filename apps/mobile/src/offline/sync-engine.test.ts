import { ApiError } from '@taskop/api-client';
import type { Db } from './db';
import { ExecutionLockedError } from './execution-store';
import { listCommands, outboxCounts } from './outbox';
import { backoffDelay, createSyncEngine, indicatorOf, type SyncStatus } from './sync-engine';
import { capturedPhoto } from './testing/fake-transport';
import { ME, myExecution, OCC, OCC2, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

const methods = (h: Harness) => h.api.calls.map((c) => c.method);
const revs = (h: Harness) => h.api.calls.filter((c) => c.method === 'saveAnswers').map((c) => (c.body as { rev: number }).rev);
const bodyOf = (h: Harness, method: string) => h.api.calls.find((c) => c.method === method)!.body as Record<string, unknown>;

/** A promise the test resolves by hand, to hold an API call in flight. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

describe('pushing the outbox', () => {
  it('sends claim, media registration, answers and completion oldest first, then pulls and uploads', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    expect(await h.store.complete(id)).toEqual({ ok: true });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'complete', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(revs(h)).toEqual([3]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(await h.store.execution(id)).toMatchObject({ state: 'completed', claim: 'accepted', syncedRev: 3, finishedSyncedAt: T.open });
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0, running: false });
    expect(indicatorOf(h.engine.status())).toBe('synced');
  });

  it('stamps each command with its action time and the offset measured at the last pull', async () => {
    const h = await createHarness();
    h.api.sync = syncResponse({ serverTime: '2026-11-02T04:08:00.000Z' });
    await h.engine.run('start');
    expect(h.engine.status().clockOffsetMs).toBe(120_000);
    await h.store.start(OCC, ME);
    h.clock.advance(5_000);
    await h.engine.run('manual');
    expect(bodyOf(h, 'claim')).toMatchObject({ startedAt: T.open, deviceTime: T.open, clientOffsetMs: 120_000 });
  });

  it('an answer made offline before closes_at keeps its action time when sent after it', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    h.net.online = false;
    h.clock.set('2026-11-02T06:50:00.000Z');
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    h.clock.set('2026-11-02T07:30:00.000Z');
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(bodyOf(h, 'saveAnswers')).toMatchObject({ rev: 1, deviceTime: '2026-11-02T06:50:00.000Z' });
    expect(await h.store.execution(id)).toMatchObject({ state: 'partial', syncedRev: 1 });
  });

  it('collapses answers edited offline into the latest revision', async () => {
    const h = await createHarness();
    h.net.online = false;
    const id = await h.store.start(OCC, ME);
    for (const n of [3, 4, 5]) await h.store.patchAnswer(id, h.c.temp.id, { number: n });
    await h.engine.run('manual');
    expect(h.api.calls).toEqual([]);
    expect(h.engine.status()).toMatchObject({ online: false, pending: 2 });
    expect(indicatorOf(h.engine.status())).toBe('pending');
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(revs(h)).toEqual([3]);
  });

  it('answers edited while their previous revision is in flight are sent next, in the same run', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    const entered = gate();
    const release = gate();
    h.api.on('saveAnswers', async (executionId, b) => {
      if (b.rev === 1) {
        entered.open();
        await release.opened;
      }
      return h.api.defaults.saveAnswers(executionId, b);
    });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 4 });
    const running = h.engine.run('manual');
    await entered.opened;
    await h.store.patchAnswer(id, h.c.temp.id, { number: 6 });
    release.open();
    await running;
    expect(revs(h)).toEqual([1, 2]);
    expect(await h.store.execution(id)).toMatchObject({ rev: 2, syncedRev: 2, answers: { [h.c.temp.id]: { number: 6 } } });
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
  });

  it('acknowledges an answers command and raises synced_rev in one transaction', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    // Deleting the acknowledged command fails, wherever it runs: the synced revision must not move without it.
    const failAck = (run: Db['run']): Db['run'] => (sql, params) =>
      sql.startsWith('DELETE FROM outbox WHERE seq') ? Promise.reject(new Error('disk I/O error')) : run(sql, params);
    const original = { run: h.db.run, transaction: h.db.transaction };
    h.db.run = failAck(original.run);
    h.db.transaction = (<T>(fn: (tx: Db) => Promise<T>) => original.transaction((tx) => fn({ ...tx, run: failAck(tx.run) }))) as Db['transaction'];
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await h.engine.run('manual');
    h.engine.stop();
    Object.assign(h.db, original);
    expect(logged).toHaveBeenCalledWith('[sync] Unexpected error; backing off', 'disk I/O error');
    logged.mockRestore();
    expect(revs(h)).toEqual([1]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
    expect(await h.store.execution(id)).toMatchObject({ rev: 1, syncedRev: 0 });
  });

  it('runs one at a time: triggers during a run schedule exactly one more pass', async () => {
    const h = await createHarness();
    const entered = gate();
    const release = gate();
    h.api.on('claim', async (b) => {
      entered.open();
      await release.opened;
      return h.api.defaults.claim(b);
    });
    await h.store.start(OCC, ME);
    const first = h.engine.run('claim');
    await entered.opened;
    expect(h.engine.status().running).toBe(true);
    const more = [h.engine.run('manual'), h.engine.run('foreground'), h.engine.run('local')];
    release.open();
    await Promise.all([first, ...more]);
    await h.engine.idle();
    expect(methods(h)).toEqual(['claim', 'pull', 'pull']);
    expect(h.engine.status().running).toBe(false);
  });

  it('never drains the media queue concurrently', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    let inFlight = 0;
    let most = 0;
    h.transport.respond(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return 200;
    });
    await Promise.all([h.engine.run('manual'), h.engine.run('foreground'), h.engine.run('manual')]);
    await h.engine.idle();
    expect(most).toBe(1);
    expect(h.api.calls.filter((c) => c.method === 'confirmUploaded')).toHaveLength(1);
  });

  it('stops draining the media queue between files once stopped', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    h.transport.respond(() => {
      h.engine.stop();
      return 200;
    });
    await h.engine.run('manual');
    expect(h.transport.uploads).toHaveLength(1);
    expect(await h.mediaQueue.counts()).toEqual({ pending: 1, failed: 0 });
  });
});

describe('media registration', () => {
  it('a registration the server reports as already uploaded is done: no upload, no confirm', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    const mediaId = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    h.api.on('registerMedia', async (executionId, b) => ({
      ...(await h.api.defaults.registerMedia(executionId, b)), status: 'uploaded', uploadUrl: null, expiresAt: null,
    }));
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'pull']);
    expect(h.transport.uploads).toEqual([]);
    expect((await h.store.media(id)).find((m) => m.id === mediaId)).toMatchObject({ registeredAt: T.open, uploadedAt: T.open, failedCode: null });
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('a permanently refused registration deletes the medium and drops it from the answers sent next', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    const photo = capturedPhoto(h.transport);
    await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    h.api.on('registerMedia', async () => {
      throw new ApiError(422, 'MEDIA_TOO_LARGE', 'errors.MEDIA_TOO_LARGE');
    });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'pull']);
    expect(bodyOf(h, 'saveAnswers')).toMatchObject({ rev: 3, answers: { [h.c.temp.id]: { number: 5 } } });
    expect((bodyOf(h, 'saveAnswers').answers as Record<string, unknown>)[h.c.photo.id]).toBeUndefined();
    expect(await h.store.execution(id)).toMatchObject({ rev: 3, syncedRev: 3, answers: { [h.c.temp.id]: { number: 5 } } });
    expect(await h.store.media(id)).toEqual([]);
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(await h.store.mediaRefusals(id)).toEqual([{ mediaId: expect.any(String), itemId: h.c.photo.id, errorKey: 'errors.MEDIA_TOO_LARGE' }]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 0 });
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(indicatorOf(h.engine.status())).toBe('synced');
  });

  it('a refused registration is also dropped from a queued completion', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    const kept = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    const refused = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    expect(await h.store.complete(id)).toEqual({ ok: true });
    h.api.on('registerMedia', async (executionId, b) => {
      if (b.id === refused) throw new ApiError(422, 'EVIDENCE_LIVE_ONLY', 'errors.EVIDENCE_LIVE_ONLY');
      return h.api.defaults.registerMedia(executionId, b);
    });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'registerMedia', 'registerMedia', 'saveAnswers', 'complete', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(bodyOf(h, 'saveAnswers')).toMatchObject({ rev: 5, answers: { [h.c.photo.id]: { photos: [kept] } } });
    expect(bodyOf(h, 'complete')).toMatchObject({ rev: 5, answers: { [h.c.photo.id]: { photos: [kept] } } });
    expect(await h.store.execution(id)).toMatchObject({ state: 'completed', rev: 5, syncedRev: 5, answers: { [h.c.photo.id]: { photos: [kept] } } });
    expect((await h.store.media(id)).map((m) => m.id)).toEqual([kept]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
  });

  it.each<[string, () => Promise<never> | null]>([
    ['accepted', () => null],
    ['refused', () => Promise.reject(new ApiError(422, 'MEDIA_TYPE_INVALID', 'errors.MEDIA_TYPE_INVALID'))],
  ])('a medium removed while its registration is in flight (%s) is skipped without an error', async (_name, outcome) => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    const mediaId = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    const entered = gate();
    const release = gate();
    h.api.on('registerMedia', async (executionId, b) => {
      entered.open();
      await release.opened;
      return outcome() ?? h.api.defaults.registerMedia(executionId, b);
    });
    const running = h.engine.run('manual');
    await entered.opened;
    await h.store.removeMedia(id, mediaId);
    release.open();
    await running;
    expect(await h.store.media(id)).toEqual([]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(await h.store.execution(id)).toMatchObject({ rev: 2, syncedRev: 2, answers: {} });
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0, blockedByAuth: false });
  });
});

describe('failures', () => {
  it.each([
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [6, 160_000],
    [7, 300_000],
    [12, 300_000],
  ])('after %i failures the backoff is %i ms', (failures, ms) => {
    expect(backoffDelay(failures)).toBe(ms);
  });

  it.each<[string, () => Error]>([
    ['a NETWORK failure', () => ApiError.network()],
    ['a 5xx', () => new ApiError(503, 'INTERNAL', 'errors.INTERNAL')],
  ])('%s stops the run and keeps the command pending', async (_name, error) => {
    const h = await createHarness();
    h.api.on('claim', async () => {
      throw error();
    });
    await h.store.start(OCC, ME);
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim']);
    expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
    expect(indicatorOf(h.engine.status())).toBe('pending');
    h.engine.stop();
  });

  it('retries after 5 s, then 10 s; interval and local-write triggers wait, foreground does not', async () => {
    jest.useFakeTimers();
    try {
      const h = await createHarness();
      h.api.on('claim', async () => {
        throw ApiError.network();
      });
      await h.store.start(OCC, ME);
      const claims = () => h.api.calls.filter((c) => c.method === 'claim').length;
      await h.engine.run('manual');
      await h.engine.run('interval');
      await h.engine.run('local');
      expect(claims()).toBe(1);
      await jest.advanceTimersByTimeAsync(4_999);
      expect(claims()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      await h.engine.idle();
      expect(claims()).toBe(2);
      await jest.advanceTimersByTimeAsync(9_999);
      expect(claims()).toBe(2);
      await h.engine.run('foreground');
      expect(claims()).toBe(3);
      h.api.reset('claim');
      await jest.advanceTimersByTimeAsync(20_000);
      await h.engine.idle();
      expect(claims()).toBe(4);
      expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
      h.engine.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('parks a command refused with a 4xx, shows it red and moves on to the next execution', async () => {
    const h = await createHarness();
    await h.seed(syncResponse({ occurrences: [occurrence(), occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması' })], checklistVersions: [versionOf(h.c.content)] }));
    h.api.on('claim', async (b) => {
      if (b.occurrenceId === OCC) throw new ApiError(422, 'CLOCK_INVALID', 'errors.CLOCK_INVALID');
      return h.api.defaults.claim(b);
    });
    const first = await h.store.start(OCC, ME);
    const second = await h.store.start(OCC2, ME);
    await h.store.patchAnswer(first, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'claim', 'pull']);
    expect(await listCommands(h.db)).toMatchObject([
      { executionId: first, kind: 'claim', status: 'failed', errorCode: 'CLOCK_INVALID', errorKey: 'errors.CLOCK_INVALID' },
      { executionId: first, kind: 'answers', status: 'pending' },
    ]);
    expect(await h.store.execution(second)).toMatchObject({ claim: 'accepted' });
    expect(indicatorOf(h.engine.status())).toBe('failed');
    h.api.reset('claim');
    await h.engine.retryFailed();
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(revs(h)).toEqual([1]);
  });

  it('an error before the push (the local lock) backs off like a network failure', async () => {
    jest.useFakeTimers();
    try {
      const h = await createHarness();
      let calls = 0;
      const engine = createSyncEngine({
        db: h.db, api: h.api.api, clock: h.clock, feed: h.feed, mediaQueue: h.mediaQueue, files: h.transport,
        isOnline: () => true,
        onClaimRejected: () => undefined,
        beforeRun: async () => {
          if (++calls <= 2) throw new Error('database is locked');
        },
      });
      await h.store.start(OCC, ME);
      const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(engine.run('manual')).resolves.toBeUndefined();
      expect(methods(h)).toEqual([]);
      expect(logged).toHaveBeenCalledWith('[sync] Unexpected error; backing off', 'database is locked');
      // The retry fired by the backoff timer fails too, without an unhandled rejection.
      await jest.advanceTimersByTimeAsync(5_000);
      await engine.idle();
      expect(methods(h)).toEqual([]);
      await jest.advanceTimersByTimeAsync(10_000);
      await engine.idle();
      expect(methods(h)).toEqual(['claim', 'pull']);
      logged.mockRestore();
      engine.stop();
      h.engine.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a completion refused for unmet requirements reopens the execution while its window is open', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    expect(await h.store.complete(id)).toEqual({ ok: true });
    h.api.on('complete', async () => {
      throw new ApiError(422, 'REQUIREMENTS_UNMET', 'errors.REQUIREMENTS_UNMET');
    });
    await h.engine.run('manual');
    expect(await listCommands(h.db)).toEqual([]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(await h.store.execution(id)).toMatchObject({ state: 'active', completedAt: null, finishedSyncedAt: null });
    await h.store.patchAnswer(id, h.c.note.id, { text: 'Düzəldildi' });
    expect(await h.store.complete(id)).toEqual({ ok: true });
    expect((await listCommands(h.db)).filter((c) => c.kind === 'complete')).toMatchObject([{ status: 'pending' }]);
  });

  it('a failed answers command is superseded by the next revision', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    h.api.on('saveAnswers', async () => {
      throw new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED');
    });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 1 });
    h.api.reset('saveAnswers');
    await h.store.patchAnswer(id, h.c.temp.id, { number: 6 });
    expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
    await h.engine.run('manual');
    expect(revs(h)).toEqual([1, 2]);
  });

  it('an expired session stops the run without failing or retrying the command', async () => {
    jest.useFakeTimers();
    try {
      const h = await createHarness();
      const id = await h.store.start(OCC, ME);
      h.api.on('saveAnswers', async () => {
        throw new ApiError(401, 'UNAUTHENTICATED', 'errors.UNAUTHENTICATED');
      });
      await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
      await h.engine.run('manual');
      expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
      expect(h.engine.status()).toMatchObject({ blockedByAuth: true, failed: 0 });
      await jest.advanceTimersByTimeAsync(600_000);
      expect(revs(h)).toEqual([1]);
      h.api.reset('saveAnswers');
      await h.engine.run('foreground');
      expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
      expect(h.engine.status().blockedByAuth).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

/** Answers everything so the store accepts a completion. */
async function completeAll(h: Harness, id: string) {
  await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
  await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
  await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
  expect(await h.store.complete(id)).toEqual({ ok: true });
}

const refuse = (code: string, status = 409) => async (): Promise<never> => {
  throw new ApiError(status, code as never, `errors.${code}`);
};

describe('refusals no retry can fix', () => {
  it('a completion refused for unmet requirements after closes_at is resolved: partial, a note, and the server copy on the next pull', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await completeAll(h, id);
    h.api.on('complete', refuse('REQUIREMENTS_UNMET', 422));
    h.clock.set('2026-11-02T07:05:00.000Z');
    h.api.sync = syncResponse({ executions: [myExecution({ id, state: 'partial', answersRev: 2, answers: { [h.c.temp.id]: { number: 5 } } })] });
    await h.engine.run('manual');
    expect(await listCommands(h.db)).toEqual([]);
    expect(indicatorOf(h.engine.status())).toBe('synced');
    expect(await h.store.execution(id)).toMatchObject({
      state: 'partial', completedAt: null, syncNote: 'errors.REQUIREMENTS_UNMET', finishedSyncedAt: '2026-11-02T07:05:00.000Z',
      // The pull took the server's answers and revision although the local revision (3) was higher.
      rev: 2, syncedRev: 2, answers: { [h.c.temp.id]: { number: 5 } },
    });
  });

  it.each(['answers', 'complete'] as const)('%s refused because the execution is no longer active is resolved, never red', async (kind) => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    if (kind === 'answers') await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    else await completeAll(h, id);
    h.api.on('saveAnswers', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.on('complete', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.sync = syncResponse({ executions: [myExecution({ id, state: 'completed', completedAt: T.due, answersRev: 0, answers: {} })] });
    await h.engine.run('manual');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(indicatorOf(h.engine.status())).toBe('synced');
    expect(await h.store.execution(id)).toMatchObject({ state: 'completed', completedAt: T.due, answers: {}, rev: 0, syncNote: 'errors.EXECUTION_NOT_ACTIVE' });
    expect((await h.store.execution(id))!.finishedSyncedAt).not.toBeNull();
  });

  it.each(['NOT_FOUND', 'NOT_EXECUTOR'])('a claim refused with %s drops the execution\'s queued work and keeps it read-only with a note', async (code) => {
    const h = await createHarness();
    await h.seed(syncResponse({ occurrences: [occurrence(), occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması' })], checklistVersions: [versionOf(h.c.content)] }));
    h.api.on('claim', async (b) => {
      if (b.occurrenceId === OCC) throw new ApiError(code === 'NOT_FOUND' ? 404 : 403, code as never, `errors.${code}`);
      return h.api.defaults.claim(b);
    });
    const first = await h.store.start(OCC, ME);
    const photo = capturedPhoto(h.transport);
    await h.store.attachMedia(first, photo, { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(first, h.c.temp.id, { number: 5 });
    const second = await h.store.start(OCC2, ME);
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'claim', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await h.store.media(first)).toEqual([]);
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(await h.store.execution(first)).toMatchObject({ state: 'rejected', claim: 'rejected', syncNote: `errors.${code}` });
    expect((await h.store.execution(first))!.finishedSyncedAt).not.toBeNull();
    expect(await h.store.execution(second)).toMatchObject({ claim: 'accepted', syncNote: null });
    expect(indicatorOf(h.engine.status())).toBe('synced');
  });

  it('any other refusal stays red until the worker retries or discards it', async () => {
    const h = await createHarness();
    h.api.on('claim', refuse('CLOCK_INVALID', 422));
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(indicatorOf(h.engine.status())).toBe('failed');
    const [claim] = await listCommands(h.db);
    await h.engine.discardCommand(claim!.seq);
    expect(await listCommands(h.db)).toEqual([]);
    expect(indicatorOf(h.engine.status())).toBe('synced');
    expect(await h.store.execution(id)).toMatchObject({ state: 'rejected', syncNote: 'errors.CLOCK_INVALID' });
    h.api.reset('claim');
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'pull', 'pull']);
  });

  it('"Sil" on failed answers removes them; the execution stays open and the next pull takes the server copy', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.temp.id, { number: 4 });
    await h.engine.run('manual');
    h.api.on('saveAnswers', refuse('VALIDATION_FAILED', 400));
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    const failed = (await listCommands(h.db)).find((c) => c.status === 'failed')!;
    // A pending command cannot be discarded.
    await h.engine.discardCommand(failed.seq + 1000);
    await h.engine.discardCommand(failed.seq);
    expect(await listCommands(h.db)).toEqual([]);
    expect(indicatorOf(h.engine.status())).toBe('synced');
    h.api.sync = syncResponse({ executions: [myExecution({ id, answersRev: 1, answers: { [h.c.temp.id]: { number: 4 } } })] });
    await h.engine.run('manual');
    expect(await h.store.execution(id)).toMatchObject({ state: 'active', rev: 1, syncedRev: 1, answers: { [h.c.temp.id]: { number: 4 } }, syncNote: 'errors.VALIDATION_FAILED' });
    h.api.reset('saveAnswers');
    await h.store.patchAnswer(id, h.c.temp.id, { number: 6 });
    await h.engine.run('manual');
    expect(revs(h).at(-1)).toBe(2);
  });

  it('"Sil" on a failed completion reopens the execution while its window is open', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await completeAll(h, id);
    h.api.on('complete', refuse('VALIDATION_FAILED', 400));
    await h.engine.run('manual');
    const failed = (await listCommands(h.db)).find((c) => c.kind === 'complete')!;
    expect(failed.status).toBe('failed');
    await h.engine.discardCommand(failed.seq);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await h.store.execution(id)).toMatchObject({ state: 'active', completedAt: null, syncNote: 'errors.VALIDATION_FAILED' });
  });
});

describe('claims and the pull', () => {
  it('marks a rejected claim locally, tells the worker who holds it, and still sends what was done', async () => {
    const h = await createHarness();
    const holder = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
    h.api.on('claim', async (b) => ({ ...(await h.api.defaults.claim(b)), state: 'rejected', reason: 'ALREADY_CLAIMED', claim: holder }));
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(await h.store.execution(id)).toMatchObject({ state: 'rejected', claim: 'rejected', rejectedReason: 'ALREADY_CLAIMED', rejectedBy: 'Murad Həsənov' });
    expect(h.rejections).toEqual([{ executionId: id, occurrenceId: OCC, reason: 'ALREADY_CLAIMED', byName: 'Murad Həsənov' }]);
    expect(methods(h)).toEqual(['claim', 'saveAnswers', 'pull']);
    expect((await h.store.occurrence(OCC))!.claim).toEqual(holder);
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 6 })).rejects.toBeInstanceOf(ExecutionLockedError);
    expect((await h.store.execution(id))!.finishedSyncedAt).toBe(T.open);
  });

  it('adopts the execution my other install already claimed, with its media and queued commands, and shows no alert', async () => {
    const h = await createHarness();
    const mine = { executionId: OTHER_EXECUTION, executorUserId: ME, executorName: 'Aysel Əliyeva' };
    h.api.on('claim', async (b) => ({ ...(await h.api.defaults.claim(b)), executionId: OTHER_EXECUTION, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: mine }));
    const id = await h.store.start(OCC, ME);
    const mediaId = await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(h.rejections).toEqual([]);
    expect(methods(h)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(h.api.calls.filter((c) => c.method !== 'claim' && c.method !== 'pull' && c.method !== 'confirmUploaded').map((c) => c.id)).toEqual([
      OTHER_EXECUTION, OTHER_EXECUTION, OTHER_EXECUTION,
    ]);
    expect(await h.store.execution(id)).toBeNull();
    expect(await h.store.execution(OTHER_EXECUTION)).toMatchObject({
      state: 'active', claim: 'accepted', rev: 2, syncedRev: 2, answers: { [h.c.temp.id]: { number: 5 }, [h.c.photo.id]: { photos: [mediaId] } },
    });
    expect(await h.store.media(OTHER_EXECUTION)).toMatchObject([{ id: mediaId, uploadedAt: T.open }]);
    expect((await h.store.occurrence(OCC))!.claim).toEqual(mine);
    await h.store.patchAnswer(OTHER_EXECUTION, h.c.temp.id, { number: 6 });
    expect(await listCommands(h.db)).toMatchObject([{ executionId: OTHER_EXECUTION, kind: 'answers', rev: 3 }]);
  });

  it('after adopting, answers the server ignores as stale are sent again above its revision and survive the pull', async () => {
    const h = await createHarness();
    const mine = { executionId: OTHER_EXECUTION, executorUserId: ME, executorName: 'Aysel Əliyeva' };
    h.api.on('claim', async (b) => ({ ...(await h.api.defaults.claim(b)), executionId: OTHER_EXECUTION, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: mine }));
    // The server holds revision 4 from my other install.
    const server = { rev: 4, answers: { [h.c.temp.id]: { number: 1 } } as Record<string, unknown> };
    h.api.on('saveAnswers', async (executionId, b) => {
      if (b.rev <= server.rev) return { ...(await h.api.defaults.saveAnswers(executionId, b)), rev: server.rev, stale: true };
      Object.assign(server, { rev: b.rev, answers: b.answers });
      return h.api.defaults.saveAnswers(executionId, b);
    });
    h.api.on('pull', async () =>
      syncResponse({
        occurrences: [occurrence({ status: 'started', claim: mine })],
        executions: [myExecution({ id: OTHER_EXECUTION, answersRev: server.rev, answers: server.answers as never })],
      }));
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(revs(h)).toEqual([1, 5]);
    expect(server).toEqual({ rev: 5, answers: { [h.c.temp.id]: { number: 5 } } });
    expect(await h.store.execution(OTHER_EXECUTION)).toMatchObject({ rev: 5, syncedRev: 5, answers: { [h.c.temp.id]: { number: 5 } } });
    await h.engine.run('manual');
    expect(await h.store.execution(OTHER_EXECUTION)).toMatchObject({ rev: 5, answers: { [h.c.temp.id]: { number: 5 } } });
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
  });

  it('adopting renumbers local revisions above a copy of the execution pulled earlier', async () => {
    const h = await createHarness();
    const mine = { executionId: OTHER_EXECUTION, executorUserId: ME, executorName: 'Aysel Əliyeva' };
    h.api.on('claim', async (b) => ({ ...(await h.api.defaults.claim(b)), executionId: OTHER_EXECUTION, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: mine }));
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.seed(syncResponse({ executions: [myExecution({ id: OTHER_EXECUTION, answersRev: 4, answers: { [h.c.temp.id]: { number: 1 } } })] }));
    await h.engine.run('manual');
    expect(revs(h)).toEqual([5]);
    expect(await h.store.execution(OTHER_EXECUTION)).toMatchObject({ rev: 5, syncedRev: 5, answers: { [h.c.temp.id]: { number: 5 } } });
    expect(await h.store.execution(id)).toBeNull();
  });

  it('pulls claims, new occurrences and executions started on another phone', async () => {
    const h = await createHarness();
    const claim = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'started', claim }), occurrence({ id: OCC2 })],
      executions: [myExecution({ occurrenceId: OCC2, answersRev: 1, answers: { [h.c.temp.id]: { number: 5 } } })],
    });
    await h.engine.run('start');
    expect(h.api.calls[0]).toEqual({ method: 'pull', id: null, body: [VERSION] });
    const views = await h.store.occurrences();
    expect(views.find((o) => o.id === OCC)!.claim).toEqual(claim);
    expect(views.find((o) => o.id === OCC2)!.execution).toMatchObject({ claim: 'accepted', rev: 1, answers: { [h.c.temp.id]: { number: 5 } } });
    expect(h.engine.status().lastSyncedAt).toBe(T.open);
  });
});

describe('indicatorOf', () => {
  const s = (over: Partial<SyncStatus>): SyncStatus => ({ pending: 0, failed: 0, running: false, online: true, lastSyncedAt: null, clockOffsetMs: 0, blockedByAuth: false, ...over });
  it('is red on failures, amber while waiting or offline, green otherwise', () => {
    expect(indicatorOf(s({ failed: 1, pending: 3 }))).toBe('failed');
    expect(indicatorOf(s({ pending: 2, online: false }))).toBe('pending');
    expect(indicatorOf(s({ online: false }))).toBe('offline');
    expect(indicatorOf(s({}))).toBe('synced');
  });
});

import type { ReworkRequest } from '@taskop/contracts';
import { ExecutionLockedError, ItemNotInReworkError, reworkEditable } from './execution-store';
import { dropMedium } from './refusals';
import { capturedPhoto } from './testing/fake-transport';
import { type Checklist, completedAnswers, ME, OCC, REWORK_EXECUTION, REWORK_PHOTO, reworkSync } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

const outbox = (h: Harness) => h.db.all<{ kind: string; rev: number | null; payload: string }>('SELECT kind, rev, payload FROM outbox ORDER BY seq');
const kinds = async (h: Harness) => (await outbox(h)).map((c) => c.kind);
const execution = async (h: Harness) => (await h.store.execution(REWORK_EXECUTION))!;

/** OCC completed by me and sent back; Temperatur and the shelf photo flagged unless `items` says otherwise. */
async function reworking(items?: (c: Checklist) => ReworkRequest['items']): Promise<Harness> {
  const h = await createHarness();
  const flagged = items ? items(h.c) : [{ itemId: h.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, { itemId: h.c.photo.id, comment: 'Şəkil bulanıqdır' }];
  await h.seed(reworkSync(h.c, flagged));
  return h;
}
/** Only the yes/no question flagged: "Bəli" reveals the required follow-up comment and asks for a photo. */
const problemOnly = (c: Checklist) => [{ itemId: c.problem.id, comment: 'Yenidən baxın' }];

describe('editing a run sent back for correction (spec §8.1)', () => {
  it('saves a flagged item as a new answers revision, also long after the window closed', async () => {
    const h = await reworking();
    h.clock.set('2026-11-05T09:00:00.000Z');
    expect(await h.store.lockExpired()).toBe(0);
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    expect(await execution(h)).toMatchObject({ state: 'rework', rev: 4, answers: { ...completedAnswers(h.c), [h.c.temp.id]: { number: 6 } } });
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['answers', 4]]);
  });

  it('refuses a change to an item that was not sent back and queues nothing', async () => {
    const h = await reworking();
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.yes.id] })).rejects.toMatchObject({ itemIds: [h.c.problem.id] });
    await expect(h.store.setProblem(REWORK_EXECUTION, h.c.problem.id, { severity: 'normal', note: 'Qapı bağlanmır', mediaIds: [] })).rejects.toBeInstanceOf(ItemNotInReworkError);
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.note.id, { text: 'əlavə' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    expect(await kinds(h)).toEqual([]);
    expect(await execution(h)).toMatchObject({ rev: 3, answers: completedAnswers(h.c) });
  });

  it('refuses a photo or a problem photo on an item that was not sent back', async () => {
    const h = await reworking();
    await expect(h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.problem.id, field: 'evidence' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    await expect(h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.note.id, field: 'problem' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    expect(await h.store.media(REWORK_EXECUTION)).toEqual([]);
    expect(await kinds(h)).toEqual([]);
  });

  it('takes a new photo on a flagged item and lets the worker flag a problem there', async () => {
    const h = await reworking();
    const mediaId = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    expect((await execution(h)).answers[h.c.photo.id]).toEqual({ photos: [REWORK_PHOTO, mediaId] });
    await h.store.setProblem(REWORK_EXECUTION, h.c.temp.id, { severity: 'normal', note: 'Termometr köhnədir', mediaIds: [] });
    expect((await execution(h)).answers[h.c.temp.id]).toEqual({ number: 5, problem: { severity: 'normal', note: 'Termometr köhnədir', mediaIds: [] } });
    expect(await kinds(h)).toEqual(['media', 'answers']);
  });

  it('resumes the run instead of claiming it again', async () => {
    const h = await reworking();
    expect(await h.store.start(OCC, ME)).toBe(REWORK_EXECUTION);
    expect(await kinds(h)).toEqual([]);
  });

  it('a medium refused after its answers were sent is dropped under a new answers revision', async () => {
    const h = await reworking();
    const mediaId = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    // The registration and the answers were accepted; the upload then failed for good.
    await h.db.run('DELETE FROM outbox');
    await h.db.run(`UPDATE executions SET synced_rev = rev`);
    await h.db.transaction((tx) => dropMedium(tx, mediaId, h.clock.now(), 'mobile.sync.mediaErrors.UPLOAD_FAILED'));
    expect(await execution(h)).toMatchObject({ rev: 5, answers: { [h.c.photo.id]: { photos: [REWORK_PHOTO] } } });
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['answers', 5]]);
  });

  it('answers a follow-up a flagged change reveals, on every later edit', async () => {
    const h = await reworking(problemOnly);
    expect(reworkEditable(h.c.content, await execution(h))).toEqual(new Set([h.c.problem.id]));
    await expect(h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.comment.id, field: 'problem' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.yes.id] });
    expect(reworkEditable(h.c.content, await execution(h))).toEqual(new Set([h.c.problem.id, h.c.comment.id]));
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.comment.id, { text: 'Kompressor səs salır' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.comment.id, { text: 'Kompressor çox səs salır' });
    const photo = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.comment.id, field: 'problem' });
    expect(await h.store.media(REWORK_EXECUTION)).toMatchObject([{ id: photo, itemId: null }]);
    expect((await execution(h)).answers).toMatchObject({ [h.c.problem.id]: { optionIds: [h.c.yes.id] }, [h.c.comment.id]: { text: 'Kompressor çox səs salır' } });
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 })).rejects.toMatchObject({ itemIds: [h.c.temp.id] });
  });

  it('hides a revealed follow-up again without being refused, leaving its answer as it is', async () => {
    const h = await reworking(problemOnly);
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.yes.id] });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.comment.id, { text: 'Kompressor səs salır' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.no.id] });
    expect(await execution(h)).toMatchObject({ rev: 6, answers: { ...completedAnswers(h.c), [h.c.comment.id]: { text: 'Kompressor səs salır' } } });
    expect(reworkEditable(h.c.content, await execution(h))).toEqual(new Set([h.c.problem.id])); // hidden again: not on screen
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['answers', 6]]);
  });

  it('is locked once resubmitted here (state completed)', async () => {
    const h = await reworking();
    await h.db.run(`UPDATE executions SET state = 'completed'`);
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 })).rejects.toBeInstanceOf(ExecutionLockedError);
  });
});

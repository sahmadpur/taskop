import { ApiError } from '@taskop/api-client';
import type { SyncTask } from '@taskop/contracts';
import { listCommands } from './outbox';
import { canEditDraft } from './task-store';
import { capturedPhoto } from './testing/fake-transport';
import { syncResponse, syncTask, T, TASK, TEAM, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

async function withTask(over: Partial<SyncTask> = {}): Promise<Harness> {
  const h = await createHarness();
  await h.seed(syncResponse({ checklistVersions: [versionOf(h.c.content)], tasks: [syncTask(over)] }));
  h.api.sync = syncResponse({ tasks: [syncTask(over)] });
  h.net.online = false; // the worker acts offline; each test goes online itself
  return h;
}
const refuse = (status: number, code: string) => async (): Promise<never> => {
  throw new ApiError(status, code as ApiError['code'], `errors.${code}`);
};
const counts = (h: Harness) =>
  h.db.first(`SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_drafts) AS drafts, (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM outbox) AS outbox`);

describe('task refusals', () => {
  it('a teammate’s earlier accept removes the team task and tells the worker', async () => {
    const h = await withTask({ assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    await h.tasks.accept(TASK);
    h.api.on('taskAccept', refuse(409, 'TASK_ALREADY_TAKEN'));
    h.api.sync = syncResponse({ tasks: [], removedTaskIds: [] }); // the server no longer lists it for this worker
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.removedTasks).toEqual([{ taskId: TASK, title: 'Soyuducunun qapısını təmir et' }]);
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('a task reassigned away while offline is removed with its queued media and files, and the notice is shown', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    await h.tasks.attachMedia(TASK, photo);
    await h.tasks.saveText(TASK, 'Hazırdır');
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    h.api.on('taskStart', refuse(404, 'NOT_FOUND'));
    h.api.sync = syncResponse({ tasks: [], removedTaskIds: [] });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'pull']);
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(h.removedTasks).toEqual([{ taskId: TASK, title: 'Soyuducunun qapısını təmir et' }]);
  });

  it('TASK_STATE_INVALID refreshes the task and keeps the draft, read-only, with the note', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.saveText(TASK, 'Rezin dəyişildi');
    await h.tasks.submit(TASK);
    h.api.on('taskSubmit', async () => {
      // The manager cancelled the task while the phone was offline.
      h.api.sync = syncResponse({ tasks: [syncTask({ status: 'cancelled', rev: 9, cancelReason: 'Lazım deyil' })] });
      throw new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID');
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method).slice(0, 4)).toEqual(['taskStart', 'taskRegisterMedia', 'taskSubmit', 'pull']);
    const task = (await h.tasks.task(TASK))!;
    expect(task).toMatchObject({ status: 'cancelled', syncNote: 'errors.TASK_STATE_INVALID', unsynced: false });
    expect(task.draft).toMatchObject({ text: 'Rezin dəyişildi', submittedAt: null });
    expect(task.draft!.mediaIds).toHaveLength(1);
    expect(canEditDraft(task)).toBe(false);
    expect(h.engine.status()).toMatchObject({ failed: 0 });
  });

  it('a task the worker can no longer read (403) is removed like a reassigned one', async () => {
    const h = await withTask({ assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    await h.tasks.accept(TASK);
    h.api.on('taskAccept', refuse(403, 'FORBIDDEN'));
    h.api.sync = syncResponse({ tasks: [], removedTaskIds: [] });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.removedTasks).toEqual([{ taskId: TASK, title: 'Soyuducunun qapısını təmir et' }]);
  });

  it('a refusal for a task the phone does not hold drops its commands and files without a notice', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    await h.tasks.attachMedia(TASK, photo);
    await h.db.run('DELETE FROM tasks'); // e.g. a manager's instruction photo of a task this phone never held
    h.api.on('taskStart', refuse(404, 'NOT_FOUND'));
    h.api.sync = syncResponse({ tasks: [] });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(h.removedTasks).toEqual([]);
  });

  it('TASK_STATE_INVALID on the start keeps the photos in the read-only draft and drops the queued registrations', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    const id = await h.tasks.attachMedia(TASK, photo);
    await h.tasks.saveText(TASK, 'Hazırdır');
    await h.tasks.submit(TASK);
    h.api.on('taskStart', async () => {
      h.api.sync = syncResponse({ tasks: [syncTask({ status: 'cancelled', rev: 9, cancelReason: 'Lazım deyil' })] });
      throw new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID');
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    const task = (await h.tasks.task(TASK))!;
    expect(task).toMatchObject({ status: 'cancelled', syncNote: 'errors.TASK_STATE_INVALID' });
    expect(task.draft!.mediaIds).toEqual([id]);
    expect(canEditDraft(task)).toBe(false);
    expect(h.transport.removed).toEqual([]);
    expect(await counts(h)).toMatchObject({ media: 1 });
  });

  it('TASK_STATE_INVALID on a photo registration reverts the task the same way and keeps the photo', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.submit(TASK);
    h.api.on('taskRegisterMedia', async () => {
      h.api.sync = syncResponse({ tasks: [syncTask({ status: 'cancelled', rev: 9, cancelReason: 'Lazım deyil' })] });
      throw new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID');
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'taskRegisterMedia', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    const task = (await h.tasks.task(TASK))!;
    expect(task).toMatchObject({ status: 'cancelled', syncNote: 'errors.TASK_STATE_INVALID' });
    expect(task.draft!.mediaIds).toHaveLength(2);
    expect(task.draft!.mediaIds).toContain(id);
    expect(h.transport.removed).toEqual([]);
    expect(await counts(h)).toMatchObject({ media: 2 });
    expect(h.engine.status()).toMatchObject({ failed: 0 });
  });

  it('EVIDENCE_REQUIRED reopens the draft for another photo instead of parking the submission', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.submit(TASK);
    h.api.on('taskSubmit', refuse(422, 'EVIDENCE_REQUIRED'));
    h.net.online = true;
    await h.engine.run('reconnect');
    const task = (await h.tasks.task(TASK))!;
    expect(task).toMatchObject({ status: 'in_progress', syncNote: 'errors.EVIDENCE_REQUIRED', unsynced: false });
    expect(canEditDraft(task)).toBe(true);
    expect(await listCommands(h.db)).toEqual([]);
  });

  it('a photo the server refuses for good leaves the draft and the queued submission, with a note on the task', async () => {
    const h = await withTask({ evidence: { photo: 'optional', video: 'optional', liveOnly: false } });
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    const id = await h.tasks.attachMedia(TASK, photo);
    await h.tasks.submit(TASK);
    h.api.on('taskRegisterMedia', refuse(422, 'MEDIA_TOO_LARGE'));
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.find((c) => c.method === 'taskSubmit')!.body).toMatchObject({ mediaIds: [] });
    expect(await h.tasks.refusals(TASK)).toEqual([{ mediaId: id, itemId: null, errorKey: 'errors.MEDIA_TOO_LARGE' }]);
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect((await h.tasks.task(TASK))!.status).toBe('completed');
  });

  it('"Sil" on a task photo that failed to upload drops it from the draft with a note', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.db.run(`DELETE FROM outbox WHERE kind = 'task.media'`);
    await h.db.run(`UPDATE media SET registered_at = ?, failed_code = 'UPLOAD_FAILED', attempts = 5`, [T.open]);
    await h.mediaQueue.discard(id);
    expect((await h.tasks.task(TASK))!.draft!.mediaIds).toEqual([]);
    expect(await h.tasks.refusals(TASK)).toEqual([{ mediaId: id, itemId: null, errorKey: 'mobile.sync.mediaErrors.UPLOAD_FAILED' }]);
  });

  it('"Sil" on a failed photo also leaves a queued submission without it', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const kept = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    const failed = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.submit(TASK);
    await h.db.run(`DELETE FROM outbox WHERE kind = 'task.media' AND ref_id = ?`, [failed]);
    await h.db.run(`UPDATE media SET registered_at = ?, failed_code = 'UPLOAD_FAILED', attempts = 5 WHERE id = ?`, [T.open, failed]);
    await h.mediaQueue.discard(failed);
    const submit = (await listCommands(h.db)).find((c) => c.kind === 'task.submit')!;
    expect((submit.payload as { mediaIds: string[] }).mediaIds).toEqual([kept]);
    expect((await h.tasks.task(TASK))!.draft!.mediaIds).toEqual([kept]);
  });
});

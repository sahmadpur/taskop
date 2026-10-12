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

  it('an instruction photo refused with TASK_STATE_INVALID for a task the phone does not hold leaves nothing behind', async () => {
    const h = await createHarness();
    h.net.online = false;
    const photo = capturedPhoto(h.transport);
    await h.tasks.queueInstructionMedia(TASK, [photo]);
    h.api.on('taskRegisterMedia', refuse(409, 'TASK_STATE_INVALID'));
    h.api.sync = syncResponse({ tasks: [] });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(h.removedTasks).toEqual([]);
  });

  it('a photo kept after TASK_STATE_INVALID is registered again when the task is started and submitted again', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    h.api.on('taskStart', async () => {
      h.api.sync = syncResponse({ tasks: [syncTask({ status: 'new', rev: 9 })] });
      throw new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID');
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await listCommands(h.db)).toEqual([]);
    h.net.online = false;
    await h.tasks.start(TASK);
    await h.tasks.submit(TASK);
    expect((await listCommands(h.db)).map((c) => [c.kind, c.refId])).toEqual([
      ['task.start', null],
      ['task.media', id],
      ['task.submit', expect.any(String)],
    ]);
  });

  it('TASK_STATE_INVALID keeps a registered, not yet uploaded photo of an accepted submission, and drops an unregistered stray', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const sent = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    const stray = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    const strayUri = (await h.db.first<{ local_uri: string }>('SELECT local_uri FROM media WHERE id = ?', [stray]))!.local_uri;
    // The submission that lists `sent` was accepted; its file is registered but still uploading, and the new draft no longer lists it.
    await h.db.run(`UPDATE media SET registered_at = ? WHERE id = ?`, [T.open, sent]);
    await h.db.run(`UPDATE task_drafts SET media_ids = '[]'`);
    await h.db.run(`DELETE FROM outbox WHERE kind = 'task.media'`);
    h.api.on('taskStart', async () => {
      h.api.sync = syncResponse({ tasks: [syncTask({ status: 'cancelled', rev: 9, cancelReason: 'Lazım deyil' })] });
      throw new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID');
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect((await h.db.all<{ id: string }>('SELECT id FROM media')).map((m) => m.id)).toEqual([sent]);
    expect(h.transport.removed).toEqual([strayUri]);
  });

  it('CLOCK_INVALID on a task photo registration parks it and keeps the photo for "Yenidən cəhd et"', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    const id = await h.tasks.attachMedia(TASK, photo);
    await h.tasks.submit(TASK);
    h.api.on('taskRegisterMedia', refuse(422, 'CLOCK_INVALID'));
    h.net.online = true;
    await h.engine.run('reconnect');
    expect((await listCommands(h.db)).filter((c) => c.kind === 'task.media').map((c) => [c.refId, c.status, c.errorCode])).toEqual([[id, 'failed', 'CLOCK_INVALID']]);
    expect(await counts(h)).toMatchObject({ media: 1 });
    expect(h.transport.removed).toEqual([]);
    expect((await h.tasks.task(TASK))!.draft!.mediaIds).toEqual([id]);
    expect(await h.tasks.refusals(TASK)).toEqual([]);
    // The submission naming the photo waits for it.
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'taskRegisterMedia', 'pull']);
    expect((await listCommands(h.db)).map((c) => [c.kind, c.status])).toEqual([['task.media', 'failed'], ['task.submit', 'pending']]);
    h.api.reset('taskRegisterMedia');
    await h.engine.retryFailed();
    expect(h.api.calls.map((c) => c.method).slice(3, 5)).toEqual(['taskRegisterMedia', 'taskSubmit']);
    expect(await listCommands(h.db)).toEqual([]);
  });

  it('a refused instruction photo of a task the phone does not hold leaves no note behind', async () => {
    const h = await createHarness();
    h.net.online = false;
    await h.tasks.queueInstructionMedia(TASK, [capturedPhoto(h.transport)]);
    h.api.on('taskRegisterMedia', refuse(422, 'MEDIA_TOO_LARGE'));
    h.api.sync = syncResponse({ tasks: [] });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await h.db.first('SELECT count(*) AS n FROM media_refusals')).toEqual({ n: 0 });
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
  });
});

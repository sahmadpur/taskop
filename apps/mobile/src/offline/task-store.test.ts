import { type SyncTask, TASK_LIMITS } from '@taskop/contracts';
import { LiveOnlyError, MediaLimitError } from './execution-store';
import { canEditDraft, isTeamOffer, TaskStateError } from './task-store';
import { capturedPhoto, capturedVideo } from './testing/fake-transport';
import { syncResponse, syncTask, T, TASK, TASK2, TEAM, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';
import { failingDriver, nodeDriver, openTestDb } from './testing/node-db';

async function withTask(over: Partial<SyncTask> = {}, h?: Harness): Promise<Harness> {
  const harness = h ?? (await createHarness());
  await harness.seed(syncResponse({ checklistVersions: [versionOf(harness.c.content)], tasks: [syncTask(over)] }));
  harness.api.sync = syncResponse({ tasks: [syncTask(over)] });
  return harness;
}
const commands = (h: Harness) =>
  h.db.all<{ kind: string; ref_id: string | null; payload: string }>(`SELECT kind, ref_id, payload FROM outbox WHERE entity_type = 'task' ORDER BY seq`);
const view = async (h: Harness, id = TASK) => (await h.tasks.task(id))!;

describe('task store', () => {
  it('accepting a team task writes its status and its command in one transaction, and syncs at once', async () => {
    const h = await withTask({ assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    expect(isTeamOffer(await view(h))).toBe(true);
    await h.tasks.accept(TASK);
    expect((await view(h)).status).toBe('accepted');
    expect(isTeamOffer(await view(h))).toBe(false);
    expect((await commands(h)).map((c) => [c.kind, JSON.parse(c.payload)])).toEqual([['task.accept', { at: T.open }]]);
    expect(h.writes).toEqual(['claim']);
  });

  it('start on a new task accepts and starts it with one command', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    expect((await view(h)).status).toBe('in_progress');
    expect((await commands(h)).map((c) => c.kind)).toEqual(['task.start']);
  });

  it('refuses what the status table refuses and writes nothing', async () => {
    const h = await withTask({ status: 'cancelled' });
    for (const action of [() => h.tasks.accept(TASK), () => h.tasks.start(TASK), () => h.tasks.saveText(TASK, 'x'), () => h.tasks.submit(TASK)]) {
      await expect(action()).rejects.toBeInstanceOf(TaskStateError);
    }
    await expect(h.tasks.attachMedia(TASK, capturedPhoto(h.transport))).rejects.toBeInstanceOf(TaskStateError);
    expect(await commands(h)).toEqual([]);
    expect(await h.db.first('SELECT count(*) AS n FROM task_drafts')).toEqual({ n: 0 });
  });

  it('queues a response medium’s registration before the submission that lists it', async () => {
    const h = await withTask({ status: 'in_progress' });
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.saveText(TASK, 'Rezin dəyişildi');
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    const queued = await commands(h);
    const draft = (await view(h)).draft!;
    expect(queued.map((c) => [c.kind, c.ref_id])).toEqual([['task.media', id], ['task.submit', draft.submissionId]]);
    expect(JSON.parse(queued[0]!.payload)).toEqual({
      id, role: 'response', kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 250_000, width: 1600, height: 1200, durationMs: null, capturedAt: T.open,
    });
    expect(JSON.parse(queued[1]!.payload)).toEqual({ id: draft.submissionId, text: 'Rezin dəyişildi', mediaIds: [id], submittedAt: T.open });
    expect((await view(h)).status).toBe('completed');
    expect(canEditDraft(await view(h))).toBe(false);
  });

  it('keeps Tamamla closed until the required evidence is attached, and goes to review when the task asks for it', async () => {
    const h = await withTask({ status: 'in_progress', requiresReview: true, evidence: { photo: 'required', video: 'required', liveOnly: false } });
    expect(await h.tasks.submit(TASK)).toEqual({ ok: false, missing: ['photo', 'video'] });
    expect(await commands(h)).toEqual([]);
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    expect(await h.tasks.submit(TASK)).toEqual({ ok: false, missing: ['video'] });
    await h.tasks.attachMedia(TASK, capturedVideo(h.transport));
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    expect((await view(h)).status).toBe('awaiting_review');
  });

  it('refuses gallery media on a live-only task, a kind the task does not take, and more than the limit', async () => {
    const h = await withTask({ status: 'in_progress', evidence: { photo: 'optional', video: 'none', liveOnly: true } });
    await expect(h.tasks.attachMedia(TASK, capturedPhoto(h.transport, { source: 'gallery' }))).rejects.toBeInstanceOf(LiveOnlyError);
    await expect(h.tasks.attachMedia(TASK, capturedVideo(h.transport))).rejects.toBeInstanceOf(MediaLimitError);
    for (let i = 0; i < TASK_LIMITS.responsePhotos; i++) await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await expect(h.tasks.attachMedia(TASK, capturedPhoto(h.transport))).rejects.toBeInstanceOf(MediaLimitError);
    expect((await view(h)).draft!.mediaIds).toHaveLength(TASK_LIMITS.responsePhotos);
  });

  it('forgets a medium never registered when it is removed, and autosaves the text under one submission id', async () => {
    const h = await withTask({ status: 'in_progress' });
    const photo = capturedPhoto(h.transport);
    const id = await h.tasks.attachMedia(TASK, photo);
    await h.tasks.removeMedia(TASK, id);
    expect(await commands(h)).toEqual([]);
    expect(await h.db.first('SELECT count(*) AS n FROM media')).toEqual({ n: 0 });
    expect(h.transport.removed).toEqual([photo.localUri]);
    await h.tasks.saveText(TASK, 'Bir');
    const first = (await view(h)).draft!;
    await h.tasks.saveText(TASK, 'İki');
    expect((await view(h)).draft).toMatchObject({ text: 'İki', mediaIds: [], submissionId: first.submissionId, submittedAt: null });
  });

  it('rolls the start back when the app is killed between the status write and the outbox append', async () => {
    const driver = failingDriver(nodeDriver(), /INSERT INTO outbox/);
    const h = await withTask({}, await createHarness({ db: await openTestDb(driver) }));
    driver.armed = true;
    await expect(h.tasks.start(TASK)).rejects.toThrow('simulated crash');
    driver.armed = false;
    expect((await view(h)).status).toBe('new');
    expect(await commands(h)).toEqual([]);
  });

  it('queues the instruction photos of a task created online, at most five', async () => {
    const h = await createHarness();
    await h.tasks.queueInstructionMedia(TASK2, [capturedPhoto(h.transport), capturedPhoto(h.transport)]);
    expect((await commands(h)).map((c) => [c.kind, JSON.parse(c.payload).role])).toEqual([['task.media', 'instruction'], ['task.media', 'instruction']]);
    expect(await h.db.all('SELECT owner_id, role FROM media')).toEqual([{ owner_id: TASK2, role: 'instruction' }, { owner_id: TASK2, role: 'instruction' }]);
    const six = Array.from({ length: TASK_LIMITS.instructionMedia + 1 }, () => capturedPhoto(h.transport));
    await expect(h.tasks.queueInstructionMedia(TASK2, six)).rejects.toBeInstanceOf(MediaLimitError);
    expect(h.writes).toEqual(['claim']);
  });

  it('offline start, photo and Tamamla reach the server in order once online', async () => {
    const h = await withTask();
    h.net.online = false;
    await h.tasks.start(TASK);
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    await h.engine.run('manual');
    expect(h.api.calls).toEqual([]);
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'taskRegisterMedia', 'taskSubmit', 'pull', 'taskRegisterMedia', 'taskConfirmUploaded']);
    expect(await h.tasks.task(TASK)).toMatchObject({ status: 'completed', draft: null, unsynced: false, failedKey: null });
    expect(await h.db.first('SELECT uploaded_at FROM media WHERE id = ?', [id])).toEqual({ uploaded_at: T.open });
  });
});

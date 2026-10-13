import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { act, createTask, newTaskBody, registerTaskMedia, taskMediaBody, taskWorld, videoExtra } from './task-fixtures';

describe('task media registration', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('registers instruction media for the creator and response media for the assignee, idempotently', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const body = taskMediaBody('instruction');
    const res = await w.manager.api.post(`/api/v1/tasks/${task.id}/media`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mediaId: body.id, status: 'pending', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '1000' } });
    expect(res.body.uploadUrl).toContain(`/t/${w.s.tenantId}/k/${task.id}/${body.id}.jpg`);
    expect((await w.manager.api.post(`/api/v1/tasks/${task.id}/media`, body)).body).toMatchObject({ mediaId: body.id, status: 'pending' });
    await act(w.workers[0].api, task.id, 'start', '2026-11-02T04:00:00.000Z');
    const response = await registerTaskMedia(w.workers[0].api, task.id, 'response', videoExtra);
    const rows = await ownerQuery<{ id: string; role: string; kind: string; captured_by_user_id: string }>(
      'select id, role, kind, captured_by_user_id from task_media where task_id = $1 order by created_at, id',
      [task.id],
    );
    expect(rows.rows).toEqual([
      { id: body.id, role: 'instruction', kind: 'photo', captured_by_user_id: w.manager.id },
      { id: response, role: 'response', kind: 'video', captured_by_user_id: w.workers[0].id },
    ]);
    expect((await w.workers[0].api.get(`/api/v1/tasks/${task.id}`)).body.media.map((m: { id: string }) => m.id)).toEqual([body.id, response]);
  });

  it('refuses the wrong role or status, gallery media on live-only tasks, kinds set to none, bad types and sizes, and future times', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const task = await createTask(w.manager.api, newTaskBody({ userId: w1.id }, { evidence: { photo: 'required', video: 'none', liveOnly: true } }));
    const code = async (api: typeof w1.api, extra: Record<string, unknown>, role: 'instruction' | 'response' = 'response') => {
      const res = await api.post(`/api/v1/tasks/${task.id}/media`, taskMediaBody(role, extra));
      return [res.status, res.body.error?.code];
    };
    expect(await code(w1.api, {})).toEqual([409, 'TASK_STATE_INVALID']);
    expect(await code(w1.api, {}, 'instruction')).toEqual([403, 'FORBIDDEN']);
    expect(await code(w2.api, {})).toEqual([404, 'NOT_FOUND']);
    await act(w1.api, task.id, 'start', '2026-11-02T04:00:00.000Z');
    expect(await code(w1.api, { source: 'gallery' })).toEqual([422, 'EVIDENCE_LIVE_ONLY']);
    expect(await code(w1.api, videoExtra)).toEqual([422, 'MEDIA_LIMIT_REACHED']);
    expect(await code(w1.api, { mime: 'image/gif' })).toEqual([422, 'MEDIA_TYPE_INVALID']);
    expect(await code(w1.api, { bytes: 5_242_881 })).toEqual([422, 'MEDIA_TOO_LARGE']);
    expect(await code(w1.api, { capturedAt: '2026-11-02T04:02:00.001Z' })).toEqual([422, 'CLOCK_INVALID']);
    expect(await code(w1.api, {})).toEqual([200, undefined]);
    await ownerQuery("update tasks set status = 'completed' where id = $1", [task.id]);
    expect(await code(w.manager.api, {}, 'instruction')).toEqual([409, 'TASK_STATE_INVALID']);
  });

  it('caps instruction media at 5 per task and unlinked response media per kind', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    for (let i = 0; i < 5; i++) await registerTaskMedia(w.manager.api, task.id, 'instruction');
    const sixth = await w.manager.api.post(`/api/v1/tasks/${task.id}/media`, taskMediaBody('instruction'));
    expect([sixth.status, sixth.body.error.code]).toEqual([422, 'MEDIA_LIMIT_REACHED']);
    await act(w.workers[0].api, task.id, 'start', '2026-11-02T04:00:00.000Z');
    // Room for retakes: max(3 × 3, 10) = 10 unsubmitted videos.
    for (let i = 0; i < 10; i++) await registerTaskMedia(w.workers[0].api, task.id, 'response', videoExtra);
    const eleventh = await w.workers[0].api.post(`/api/v1/tasks/${task.id}/media`, taskMediaBody('response', videoExtra));
    expect([eleventh.status, eleventh.body.error.code]).toEqual([422, 'MEDIA_LIMIT_REACHED']);
  });

  it('replays an uploaded medium’s registration without a URL, so stored evidence cannot be overwritten', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const body = taskMediaBody('instruction');
    await w.manager.api.post(`/api/v1/tasks/${task.id}/media`, body);
    await ownerQuery("update task_media set status = 'uploaded', uploaded_at = now() where id = $1", [body.id]);
    await ownerQuery("update tasks set status = 'completed' where id = $1", [task.id]);
    const replay = await w.manager.api.post(`/api/v1/tasks/${task.id}/media`, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toEqual({ mediaId: body.id, status: 'uploaded', uploadUrl: null, headers: {}, expiresAt: null });
    expect((await w.workers[0].api.post(`/api/v1/tasks/${task.id}/media`, body)).status).toBe(404);
  });

  it('lets only the current assignee replay response media: a reassigned-away uploader gets 404 (R4)', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const task = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    await act(w1.api, task.id, 'start', '2026-11-02T04:00:00.000Z');
    const body = taskMediaBody('response');
    expect((await w1.api.post(`/api/v1/tasks/${task.id}/media`, body)).status).toBe(200);
    // Whatever the status, the current assignee still gets the stored result.
    await ownerQuery("update tasks set status = 'awaiting_review' where id = $1", [task.id]);
    expect((await w1.api.post(`/api/v1/tasks/${task.id}/media`, body)).body).toMatchObject({ mediaId: body.id, status: 'pending' });
    await ownerQuery('update tasks set assignee_user_id = $2 where id = $1', [task.id, w2.id]);
    const replay = await w1.api.post(`/api/v1/tasks/${task.id}/media`, body);
    expect([replay.status, replay.body.error.code]).toEqual([404, 'NOT_FOUND']);
    expect((await w2.api.post(`/api/v1/tasks/${task.id}/media`, body)).status).toBe(404);
  });
});

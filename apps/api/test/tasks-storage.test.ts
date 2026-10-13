import type { MediaUploadTicket, MediaUrl, TaskDetail } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Service } from '../src/storage/s3.service';
import { TaskJobs } from '../src/tasks/task-jobs';
import { createTestApp, type TestApp } from './app';
import { completeExecution, liveExecution, registerBytes } from './execution-fixtures';
import { ownerQuery } from './owner-db';
import type { Api } from './scheduling-fixtures';
import { type Seaweed, startSeaweedfs } from './seaweedfs';
import { act, createTask, newTaskBody, taskMediaBody, taskWorld } from './task-fixtures';

/** Real time throughout: SeaweedFS checks signatures against its own clock. */
describe('task media against SeaweedFS', () => {
  let sw: Seaweed;
  let t: TestApp;
  beforeAll(async () => {
    sw = await startSeaweedfs();
    t = await createTestApp(sw.env);
  });
  afterAll(async () => {
    await t?.close();
    await sw?.stop();
  });

  const upload = (ticket: MediaUploadTicket, body: Buffer) =>
    fetch(ticket.uploadUrl!, { method: 'PUT', body: new Uint8Array(body), headers: { 'Content-Type': ticket.headers['Content-Type']! } });

  async function register(api: Api, taskId: string, role: 'instruction' | 'response', bytes: number) {
    const body = taskMediaBody(role, { bytes, capturedAt: new Date().toISOString() });
    const res = await api.post(`/api/v1/tasks/${taskId}/media`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { id: body.id, ticket: res.body as MediaUploadTicket };
  }

  /** The manager's task for İşçi 1, started now. */
  async function startedTask() {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    expect((await act(w.workers[0].api, task.id, 'start', new Date().toISOString())).status).toBe(200);
    return { w, taskId: task.id };
  }

  it('confirms an upload for the uploader only, refuses it before the PUT, and serves view URLs to task readers', async () => {
    const { w, taskId } = await startedTask();
    const api = w.workers[0].api;
    const bytes = Buffer.alloc(2048, 1);
    const { id, ticket } = await register(api, taskId, 'response', bytes.length);
    const early = await api.post(`/api/v1/task-media/${id}/uploaded`);
    expect([early.status, early.body.error.code]).toEqual([422, 'MEDIA_NOT_FOUND_IN_STORAGE']);
    expect((await api.get(`/api/v1/task-media/${id}/url`)).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
    expect((await upload(ticket, bytes)).status).toBe(200);
    expect((await w.manager.api.post(`/api/v1/task-media/${id}/uploaded`)).status).toBe(403);
    expect((await w.workers[1].api.post(`/api/v1/task-media/${id}/uploaded`)).status).toBe(404);
    const ok = await api.post(`/api/v1/task-media/${id}/uploaded`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ mediaId: id, status: 'uploaded' });
    expect((await api.post(`/api/v1/task-media/${id}/uploaded`)).body.uploadedAt).toBe(ok.body.uploadedAt);
    const forManager = await w.manager.api.get(`/api/v1/task-media/${id}/url`);
    expect(forManager.status, JSON.stringify(forManager.body)).toBe(200);
    expect(Buffer.from(await (await fetch(forManager.body.url)).arrayBuffer())).toEqual(bytes);
    expect((await api.get(`/api/v1/task-media/${id}/url`)).status).toBe(200);
    expect((await w.workers[2].api.get(`/api/v1/task-media/${id}/url`)).status).toBe(404);
  });

  it('signs the source problem’s media for whoever can read the task, and nothing else', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(300, 4);
    const item = await registerBytes(api, executionId, w.c.photo.id, 10);
    const evidence = await registerBytes(api, executionId, null, bytes.length);
    expect((await upload(evidence.ticket, bytes)).status).toBe(200);
    expect((await api.post(`/api/v1/media/${evidence.id}/uploaded`)).status).toBe(200);
    const done = await completeExecution(
      api,
      executionId,
      1,
      {
        [w.c.problem.id]: { optionIds: [w.c.no.id] },
        [w.c.temp.id]: { number: 5, problem: { severity: 'critical', note: 'Qapı sınıqdır', mediaIds: [evidence.id] } },
        [w.c.photo.id]: { photos: [item.id] },
      },
      new Date().toISOString(),
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const problemId = (await ownerQuery<{ id: string }>("select id from execution_problems where execution_id = $1 and source = 'manual'", [executionId])).rows[0]!.id;
    const task = await createTask(w.owner, newTaskBody({ userId: w.workers[1].id }, { problemId }));
    // The card says what to draw before anything is signed (Spec decision 24).
    expect(task.problem!.media).toEqual([{ id: evidence.id, kind: 'photo', status: 'uploaded' }]);
    const assignee = w.workers[1].api;
    expect((await assignee.get(`/api/v1/media/${evidence.id}/url`)).status).toBe(404);
    const signed = await assignee.get(`/api/v1/tasks/${task.id}/problem-media/${evidence.id}/url`);
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(Buffer.from(await (await fetch(signed.body.url)).arrayBuffer())).toEqual(bytes);
    expect((await assignee.get(`/api/v1/tasks/${task.id}/problem-media/${item.id}/url`)).status).toBe(404);
    expect((await w.workers[0].api.get(`/api/v1/tasks/${task.id}/problem-media/${evidence.id}/url`)).status).toBe(404);
  });

  it('deletes the objects of task media never confirmed after 14 days, once, and keeps the rows', async () => {
    const { w, taskId } = await startedTask();
    const old = await register(w.workers[0].api, taskId, 'response', 10);
    const recent = await register(w.manager.api, taskId, 'instruction', 10);
    expect((await upload(old.ticket, Buffer.alloc(10))).status).toBe(200);
    expect((await upload(recent.ticket, Buffer.alloc(10))).status).toBe(200);
    await ownerQuery("update task_media set created_at = now() - interval '15 days' where id = $1", [old.id]);
    await ownerQuery("update task_media set created_at = now() - interval '13 days' where id = $1", [recent.id]);
    const jobs = t.app.get(TaskJobs);
    const s3 = t.app.get(S3Service);
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(1);
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(0);
    const row = async (id: string) =>
      (await ownerQuery<{ status: string; storage_key: string; purged: boolean }>('select status, storage_key, storage_purged_at is not null as purged from task_media where id = $1', [id])).rows[0]!;
    const o = await row(old.id);
    expect([o.status, o.purged]).toEqual(['pending', true]);
    expect(await s3.head(o.storage_key)).toBeNull();
    const r = await row(recent.id);
    expect([r.status, r.purged]).toEqual(['pending', false]);
    expect(await s3.head(r.storage_key)).not.toBeNull();
    expect((await w.workers[0].api.post(`/api/v1/task-media/${old.id}/uploaded`)).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
    // The purged medium stays in the task, still pending (Interfaces: there is no purged status).
    const detail = (await w.manager.api.get(`/api/v1/tasks/${taskId}`)).body as TaskDetail;
    expect(detail.media.find((m) => m.id === old.id)).toMatchObject({ status: 'pending', uploadedAt: null });
  });

  it('answers 404 to a reassigned-away uploader who confirms their response medium (R4)', async () => {
    const { w, taskId } = await startedTask();
    const bytes = Buffer.alloc(64, 2);
    const { id, ticket } = await register(w.workers[0].api, taskId, 'response', bytes.length);
    expect((await upload(ticket, bytes)).status).toBe(200);
    expect((await w.manager.api.patch(`/api/v1/tasks/${taskId}`, { assignee: { userId: w.workers[1].id } })).status).toBe(200);
    expect((await w.workers[0].api.post(`/api/v1/task-media/${id}/uploaded`)).status).toBe(404);
    expect((await w.workers[0].api.get(`/api/v1/task-media/${id}/url`)).status).toBe(404);
  });

  it('lets the web dev origins upload to and read from presigned URLs, and refuses other origins (bucket CORS)', async () => {
    const { w, taskId } = await startedTask();
    const { id, ticket } = await register(w.workers[0].api, taskId, 'response', 10);
    const preflight = (origin: string) =>
      fetch(ticket.uploadUrl!, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
    for (const origin of ['http://localhost:5173', 'http://localhost:4173']) {
      const ok = await preflight(origin);
      expect(ok.status, origin).toBe(200);
      expect(ok.headers.get('access-control-allow-origin')).toBe(origin);
      expect(ok.headers.get('access-control-allow-methods')).toContain('PUT');
      expect(ok.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    }
    // A bucket rule replaces SeaweedFS's default `-s3.allowedOrigins=*`.
    expect((await preflight('https://evil.example')).status).toBe(403);
    // The PUT and the GET answer the dev origin with the headers the browser checks; ETag is readable.
    const put = await fetch(ticket.uploadUrl!, { method: 'PUT', body: new Uint8Array(10), headers: { 'Content-Type': ticket.headers['Content-Type']!, Origin: 'http://localhost:5173' } });
    expect(put.status, await put.clone().text()).toBe(200);
    expect(put.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(put.headers.get('access-control-expose-headers')).toContain('ETag');
    expect((await w.workers[0].api.post(`/api/v1/task-media/${id}/uploaded`)).status).toBe(200);
    const view = (await w.manager.api.get(`/api/v1/task-media/${id}/url`)).body as MediaUrl;
    const get = await fetch(view.url, { headers: { Origin: 'http://localhost:5173' } });
    expect([get.status, get.headers.get('access-control-allow-origin')]).toEqual([200, 'http://localhost:5173']);
  });
});

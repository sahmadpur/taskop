import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { MONDAY_0800 } from './scheduling-fixtures';
import { ownerQuery } from './owner-db';
import { closedRunWithProblems, createTask, newTaskBody, registerTaskMedia, taskMediaBody, type TaskWorld, taskWorld } from './task-fixtures';

const AT = '2026-11-02T04:00:00.000Z';

describe('task tenant isolation', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let A: TaskWorld;
  let B: TaskWorld;
  const a: Record<string, string> = {};
  /** Tenant A: a task created from a problem that really carries a (pending, never uploaded) execution media row. */
  const problemTask = { id: '', mediaId: '', reader: null as unknown as TaskWorld['workers'][0]['api'] };
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    A = await taskWorld(t);
    a.task = (await createTask(A.manager.api, newTaskBody({ userId: A.workers[0].id }))).id;
    a.media = await registerTaskMedia(A.manager.api, a.task, 'instruction');
    const run = await closedRunWithProblems(t, clock);
    const media = (await ownerQuery<{ id: string }>('select id from execution_media where execution_id = $1 limit 1', [run.executionId])).rows[0]!;
    await ownerQuery('update execution_problems set media_ids = array[$1::uuid] where id = $2', [media.id, run.manualProblemId]);
    problemTask.id = (await createTask(run.w.owner, newTaskBody({ userId: run.w.workers[1].id }, { problemId: run.manualProblemId }))).id;
    problemTask.mediaId = media.id;
    problemTask.reader = run.w.workers[1].api;
    B = await taskWorld(t);
  });
  afterAll(() => t.close());

  // [route, method, url, body, also as B's worker?] Manager routes answer a worker 403 before any lookup.
  it.each([
    ['GET /tasks/:id', 'GET', () => `/api/v1/tasks/${a.task}`, undefined, true],
    ['PATCH /tasks/:id', 'PATCH', () => `/api/v1/tasks/${a.task}`, { title: 'x' }, false],
    ['POST /tasks/:id/cancel', 'POST', () => `/api/v1/tasks/${a.task}/cancel`, { reason: 'x' }, false],
    ['POST /tasks/:id/review', 'POST', () => `/api/v1/tasks/${a.task}/review`, { decision: 'approve' }, true],
    ['POST /tasks/:id/accept', 'POST', () => `/api/v1/tasks/${a.task}/accept`, { at: AT }, true],
    ['POST /tasks/:id/start', 'POST', () => `/api/v1/tasks/${a.task}/start`, { at: AT }, true],
    ['POST /tasks/:id/submissions', 'POST', () => `/api/v1/tasks/${a.task}/submissions`, { id: uuidv7(), submittedAt: AT }, true],
    ['POST /tasks/:id/media', 'POST', () => `/api/v1/tasks/${a.task}/media`, taskMediaBody('response'), true],
    ['POST /task-media/:id/uploaded', 'POST', () => `/api/v1/task-media/${a.media}/uploaded`, {}, true],
    ['GET /task-media/:id/url', 'GET', () => `/api/v1/task-media/${a.media}/url`, undefined, true],
    ['GET /tasks/:id/problem-media/:mediaId/url', 'GET', () => `/api/v1/tasks/${problemTask.id}/problem-media/${problemTask.mediaId}/url`, undefined, true],
  ] as const)('%s on a foreign id returns 404', async (_name, method, url, body, asWorker) => {
    for (const api of asWorker ? [B.owner, B.workers[0].api] : [B.owner]) {
      const path = url();
      const res = method === 'GET' ? await api.get(path) : method === 'PATCH' ? await api.patch(path, body!) : await api.post(path, body ?? {});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('serves the problem media of a real task to its reader, so the foreign 404 above is the tenant check', async () => {
    const res = await problemTask.reader.get(`/api/v1/tasks/${problemTask.id}/problem-media/${problemTask.mediaId}/url`);
    expect([res.status, res.body.error?.code]).toEqual([422, 'MEDIA_NOT_FOUND_IN_STORAGE']);
  });

  it('never lists or syncs the other tenant’s tasks, and refuses its people, teams and sites', async () => {
    expect((await B.owner.get('/api/v1/tasks?limit=200')).body.items.map((i: { id: string }) => i.id)).not.toContain(a.task);
    expect((await B.workers[0].api.get('/api/v1/me/sync')).body.tasks).toEqual([]);
    expect((await B.owner.post('/api/v1/tasks', newTaskBody({ userId: A.workers[0].id }))).body.error.code).toBe('TASK_ASSIGNEE_INVALID');
    expect((await B.owner.post('/api/v1/tasks', newTaskBody({ teamId: A.teamId }))).body.error.code).toBe('TASK_ASSIGNEE_INVALID');
    expect((await B.owner.post('/api/v1/tasks', newTaskBody({ userId: B.workers[0].id }, { siteId: A.siteId }))).body.error.code).toBe('REFERENCE_NOT_FOUND');
    const options = (await B.owner.get('/api/v1/tasks/assignees')).body;
    expect(options.users.map((u: { id: string }) => u.id)).not.toContain(A.workers[0].id);
    expect(options.teams.map((x: { id: string }) => x.id)).toEqual([B.teamId]);
    expect(options.sites.map((x: { id: string }) => x.id)).not.toContain(A.siteId);
  });
});

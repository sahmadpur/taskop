import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, executionWorld, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems, insertTaskRow } from './task-fixtures';

type Row = { id: string; resolution: string; taskId: string | null };
const byId = (items: Row[]) => Object.fromEntries(items.map((p) => [p.id, [p.resolution, p.taskId]]));
const ids = (items: Row[]) => items.map((p) => p.id);

describe('problem resolution', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('derives resolution and taskId from the linked task on /problems and the execution detail, and filters by it', async () => {
    const { w, executionId, manualProblemId, ruleProblemId } = await closedRunWithProblems(t, clock);
    const taskId = await insertTaskRow({ tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId: manualProblemId, status: 'in_progress' });
    const get = async (qs = '') => (await w.owner.get(`/api/v1/problems?from=2026-11-01&to=2026-11-30${qs}`)).body.items as Row[];
    expect(byId(await get())).toEqual({ [manualProblemId]: ['open', taskId], [ruleProblemId]: ['none', null] });
    expect((await get())[0]).toMatchObject({ executionState: 'completed' });
    expect(ids(await get('&resolution=open'))).toEqual([manualProblemId]);
    expect(ids(await get('&resolution=none'))).toEqual([ruleProblemId]);
    expect(byId((await w.owner.get(`/api/v1/executions/${executionId}`)).body.problems)).toEqual({ [manualProblemId]: ['open', taskId], [ruleProblemId]: ['none', null] });
    await ownerQuery("update tasks set status = 'completed' where id = $1", [taskId]);
    expect(ids(await get('&resolution=resolved'))).toEqual([manualProblemId]);
    await ownerQuery("update tasks set status = 'cancelled' where id = $1", [taskId]);
    expect(ids(await get('&resolution=cancelled'))).toEqual([manualProblemId]);
    expect(await get('&resolution=open')).toEqual([]);
  });

  it('reports executionState for a problem on an active run as well as a closed one', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    expect((await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 10, note: 'isti' } }, '2026-11-02T04:15:00.000Z'))).status).toBe(200);
    const items = (await w.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items as Array<{ executionId: string; executionState: string }>;
    expect(items.find((i) => i.executionId === executionId)!.executionState).toBe('active');
  });

  it('gives each problem medium its kind and status, in the order the answer lists them', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const video = await registerPhoto(api, executionId, null, { kind: 'video', mime: 'video/mp4', width: 1280, height: 720, durationMs: 10_000 });
    const photo = await registerPhoto(api, executionId, null);
    // Uploaded and confirmed (no storage in this suite): the row is what the DTO reads.
    await ownerQuery("update execution_media set status = 'uploaded', uploaded_at = now() where id = $1", [photo]);
    const answers = answersBody(1, { [w.c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Qapı bağlanmır', mediaIds: [video, photo] } } }, '2026-11-02T04:20:00.000Z');
    expect((await api.put(`/api/v1/executions/${executionId}/answers`, answers)).status).toBe(200);
    const items = (await w.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items as Array<{ executionId: string; mediaIds: string[]; media: unknown[] }>;
    const p = items.find((i) => i.executionId === executionId)!;
    expect(p.mediaIds).toEqual([video, photo]);
    expect(p.media).toEqual([
      { id: video, kind: 'video', status: 'pending' },
      { id: photo, kind: 'photo', status: 'uploaded' },
    ]);
  });

  it('keeps a problem that has a task when a late answers sync no longer derives it', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    expect((await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 10, note: 'isti' } }, '2026-11-02T04:15:00.000Z'))).status).toBe(200);
    clock.set('2026-11-02T07:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    const problemId = (await ownerQuery<{ id: string }>('select id from execution_problems where execution_id = $1', [executionId])).rows[0]!.id;
    await insertTaskRow({ tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId });
    // Captured at 10:30 Baku, inside the window, synced after the sweep: the temperature was fine after all.
    const late = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(2, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T06:30:00.000Z'));
    expect(late.status, JSON.stringify(late.body)).toBe(200);
    expect((await ownerQuery('select id from execution_problems where execution_id = $1', [executionId])).rows).toEqual([{ id: problemId }]);
  });

  it('still deletes vanished problems that have no task', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 10, note: 'isti' } }, '2026-11-02T04:15:00.000Z'));
    await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(2, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:16:00.000Z'));
    expect((await ownerQuery('select id from execution_problems where execution_id = $1', [executionId])).rows).toEqual([]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, executionWorld } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff } from './fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems, createTask, newTaskBody } from './task-fixtures';

describe('tasks from problems', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('takes the problem’s site, turns review on by default and shows the problem card to the assignee', async () => {
    const { w, manualProblemId, ruleProblemId } = await closedRunWithProblems(t, clock);
    const body = newTaskBody({ userId: w.workers[1].id }, { problemId: manualProblemId, siteId: w.otherSiteId, title: 'Temperatur', priority: 'high' });
    const task = await createTask(w.owner, body);
    const card = {
      id: manualProblemId,
      itemLabel: 'Temperatur',
      source: 'manual',
      severity: 'critical',
      note: 'Kondisioner xarabdır',
      siteName: 'Filial 1',
      checklistName: 'İcra yoxlaması',
      executorName: 'İşçi 1',
      resolution: 'open',
      taskId: task.id,
      executionState: 'completed',
    };
    expect(task).toMatchObject({ source: 'problem', problemId: manualProblemId, site: { id: w.siteId, name: 'Filial 1' }, requiresReview: true, problem: card });
    const asAssignee = await w.workers[1].api.get(`/api/v1/tasks/${task.id}`);
    expect(asAssignee.status, JSON.stringify(asAssignee.body)).toBe(200);
    expect(asAssignee.body.problem).toMatchObject(card);
    const open = (await w.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30&resolution=open')).body.items;
    expect(open.map((p: { id: string; taskId: string }) => [p.id, p.taskId])).toEqual([[manualProblemId, task.id]]);
    const explicit = await createTask(w.owner, newTaskBody({ userId: w.workers[1].id }, { problemId: ruleProblemId, requiresReview: false }));
    expect(explicit.requiresReview).toBe(false);
  });

  it('refuses a problem of a run still open, a second task for a problem, and problems the caller cannot read', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await w.workers[0].api.put(
      `/api/v1/executions/${executionId}/answers`,
      answersBody(1, { [w.c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Qapı sınıqdır', mediaIds: [] } } }, '2026-11-02T04:20:00.000Z'),
    );
    const openProblem = (await ownerQuery<{ id: string }>('select id from execution_problems where execution_id = $1', [executionId])).rows[0]!.id;
    const open = await w.owner.post('/api/v1/tasks', newTaskBody({ userId: w.workers[1].id }, { problemId: openProblem }));
    expect([open.status, open.body.error.code]).toEqual([409, 'PROBLEM_NOT_CLOSED']);

    clock.set(MONDAY_0800); // a new world materialises today's occurrence only before its window opens
    const c = await closedRunWithProblems(t, clock);
    await createTask(c.w.owner, newTaskBody({ userId: c.w.workers[1].id }, { problemId: c.manualProblemId }));
    const again = await c.w.owner.post('/api/v1/tasks', newTaskBody({ userId: c.w.workers[1].id }, { problemId: c.manualProblemId }));
    expect([again.status, again.body.error.code]).toEqual([409, 'PROBLEM_ALREADY_HAS_TASK']);

    const u = await createUserDirect(t, c.w.s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    await c.w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [c.w.otherSiteId] });
    const outside = as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
    expect((await outside.post('/api/v1/tasks', newTaskBody({ userId: u.id }, { problemId: c.ruleProblemId }))).status).toBe(404);
  });

  it('refuses a problem a correction cleared (ruling F3)', async () => {
    const c = await closedRunWithProblems(t, clock);
    const fixed = await c.w.owner.post(`/api/v1/executions/${c.executionId}/corrections`, {
      answersRev: 1,
      changes: [{ itemId: c.w.c.temp.id, answer: { number: 5 } }],
      reason: 'Səhv ölçülüb',
    });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    const cleared = await ownerQuery<{ id: string }>('select id from execution_problems where execution_id = $1 and cleared_at is not null', [c.executionId]);
    expect(cleared.rows.map((r) => r.id)).toContain(c.ruleProblemId);
    const res = await c.w.owner.post('/api/v1/tasks', newTaskBody({ userId: c.w.workers[1].id }, { problemId: c.ruleProblemId }));
    expect([res.status, res.body.error.code]).toEqual([409, 'PROBLEM_NOT_CLOSED']);
    expect((await ownerQuery('select id from tasks where problem_id = $1', [c.ruleProblemId])).rows).toEqual([]);
  });

  it('answers PROBLEM_ALREADY_HAS_TASK to the loser of two concurrent creates for one problem', async () => {
    const c = await closedRunWithProblems(t, clock);
    const body = () => newTaskBody({ userId: c.w.workers[1].id }, { problemId: c.ruleProblemId });
    const results = await Promise.all([c.w.owner.post('/api/v1/tasks', body()), c.w.owner.post('/api/v1/tasks', body())]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('PROBLEM_ALREADY_HAS_TASK');
  });
});

import type { Answers, TaskAssignee, TaskDetail } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { DomainEvents, type TaskEventName } from '../src/common/domain-events';
import { claimOk, completeExecution, executionWorld, registerPhoto, type TestWorker } from './execution-fixtures';
import type { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, loginWorker, type SignedUpTenant, signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';
import type { Api } from './scheduling-fixtures';

export interface TaskRowInput {
  tenantId: string;
  createdBy: string;
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  problemId?: string | null;
  status?: string;
  id?: string;
}

/** A task row straight in the DB (owner connection, no API), for tests that only need a task to exist. */
export async function insertTaskRow(v: TaskRowInput): Promise<string> {
  const id = v.id ?? uuidv7();
  await ownerQuery(
    `insert into tasks (id, tenant_id, title, created_by_user_id, assignee_user_id, assignee_team_id, problem_id, status)
     values ($1, $2, 'Test tapşırığı', $3, $4, $5, $6, $7)`,
    [id, v.tenantId, v.createdBy, v.assigneeUserId ?? null, v.assigneeTeamId ?? null, v.problemId ?? null, v.status ?? 'new'],
  );
  return id;
}

/**
 * İşçi 1 completes today's run at 08:20 Baku with two problems on the temperature: a manual critical one
 * ("Kondisioner xarabdır") and the rule one (10 °C, note "isti"). The run is closed, so both can get tasks.
 */
export async function closedRunWithProblems(t: TestApp, clock: FakeClock) {
  const w = await executionWorld(t);
  const api = w.workers[0].api;
  clock.set('2026-11-02T04:20:00Z');
  const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
  const photo = await registerPhoto(api, executionId, w.c.photo.id);
  const answers: Answers = {
    [w.c.problem.id]: { optionIds: [w.c.no.id] },
    [w.c.temp.id]: { number: 10, note: 'isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } },
    [w.c.photo.id]: { photos: [photo] },
  };
  const res = await completeExecution(api, executionId, 1, answers, '2026-11-02T04:20:00.000Z');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const rows = (await ownerQuery<{ id: string; source: string }>('select id, source from execution_problems where execution_id = $1', [executionId])).rows;
  const idOf = (source: string) => rows.find((r) => r.source === source)!.id;
  return { w, executionId, manualProblemId: idOf('manual'), ruleProblemId: idOf('rule') };
}

export interface TaskWorld {
  s: SignedUpTenant;
  owner: Api;
  /** Filial 1 and Filial 2. */
  siteId: string;
  otherSiteId: string;
  /** "Menecer": built-in manager role (site_subtree, tasks.view + tasks.manage), linked to Filial 1. */
  manager: TestWorker;
  /** İşçi 1 and İşçi 2 at Filial 1 (both in the team), İşçi 3 at Filial 2; logged in on mobile. */
  workers: [TestWorker, TestWorker, TestWorker];
  /** "Texniki xidmət": İşçi 1 and İşçi 2. */
  teamId: string;
}

export async function taskWorld(t: TestApp): Promise<TaskWorld> {
  const s = await signupTenant(t);
  const owner = as(t, s.accessToken);
  const typeId = await siteTypeIdOf(s.tenantId);
  const siteId = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 1' })).body.id as string;
  const otherSiteId = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 2' })).body.id as string;
  const workers: TestWorker[] = [];
  for (const [fullName, site] of [['İşçi 1', siteId], ['İşçi 2', siteId], ['İşçi 3', otherSiteId]] as const) {
    const u = await createUserDirect(t, s.tenantId, { fullName });
    expect((await owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [site] })).status).toBe(200);
    workers.push({ id: u.id, api: as(t, (await loginWorker(t, s.orgCode, u.username!, u.secret)).accessToken) });
  }
  const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager', fullName: 'Menecer', emailVerified: true });
  expect((await owner.put(`/api/v1/users/${m.id}/sites`, { siteIds: [siteId] })).status).toBe(200);
  const manager = { id: m.id, api: as(t, (await loginStaff(t, m.email!, m.secret)).accessToken) };
  const team = await owner.post('/api/v1/teams', { name: 'Texniki xidmət' });
  expect(team.status, JSON.stringify(team.body)).toBe(201);
  expect((await owner.put(`/api/v1/teams/${team.body.id}/members`, { userIds: [workers[0]!.id, workers[1]!.id] })).status).toBe(200);
  return { s, owner, siteId, otherSiteId, manager, workers: workers as [TestWorker, TestWorker, TestWorker], teamId: team.body.id as string };
}

export const newTaskBody = (assignee: TaskAssignee, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  title: 'Soyuducunun qapısını təmir edin',
  instructions: 'Qapının rezinini dəyişin.',
  assignee,
  ...over,
});

export async function createTask(api: Api, body: object): Promise<TaskDetail> {
  const res = await api.post('/api/v1/tasks', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as TaskDetail;
}

/** [from, to, actor user id, comment] in order. */
export async function taskHistory(taskId: string): Promise<Array<[string | null, string, string | null, string | null]>> {
  const r = await ownerQuery<{ from_status: string | null; to_status: string; actor_user_id: string | null; comment: string | null }>(
    'select from_status, to_status, actor_user_id, comment from task_status_history where task_id = $1 order by at, id',
    [taskId],
  );
  return r.rows.map((h) => [h.from_status, h.to_status, h.actor_user_id, h.comment]);
}

export async function auditActions(taskId: string): Promise<string[]> {
  const r = await ownerQuery<{ action: string }>("select action from audit_log where entity_type = 'task' and entity_id = $1 order by occurred_at, id", [taskId]);
  return r.rows.map((x) => x.action);
}

const TASK_EVENTS: TaskEventName[] = ['task.assigned', 'task.accepted', 'task.submitted', 'task.rejected', 'task.completed', 'task.cancelled', 'task.overdue'];

/** Records [event, taskId, actorUserId] for every task.* event until `stop()`. */
export function captureTaskEvents(t: TestApp) {
  const events = t.app.get(DomainEvents);
  const seen: Array<[TaskEventName, string, string | null]> = [];
  const offs = TASK_EVENTS.map((name) => events.on(name, (e) => void seen.push([name, e.taskId, e.actorUserId])));
  return { seen, stop: () => offs.forEach((off) => off()) };
}

export interface TaskDbRow {
  status: string;
  assignee_user_id: string | null;
  assignee_team_id: string | null;
  accepted_at: Date | null;
  started_at: Date | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  due_at: Date | null;
  overdue_at: Date | null;
  rev: number;
  updated_at: Date;
}

export const taskRow = async (id: string): Promise<TaskDbRow> => (await ownerQuery<TaskDbRow>('select * from tasks where id = $1', [id])).rows[0]!;

export const act = (api: Api, taskId: string, action: 'accept' | 'start', at: string) => api.post(`/api/v1/tasks/${taskId}/${action}`, { at });

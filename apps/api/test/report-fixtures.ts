import { emptyRunCounts, type OccurrenceStatus, type RunCounts, type TaskStatus } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { as, createUserDirect, loginStaff, type SignedUpTenant, signupTenant, siteTypeIdOf } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, publishedChecklist } from './scheduling-fixtures';

/** Wednesday 2026-11-04 12:00 in Baku (UTC+4): "now" of every report test. */
export const REPORT_NOW = '2026-11-04T08:00:00Z';
/** Monday to Wednesday of the fixture week. */
export const PERIOD = { from: '2026-11-02', to: '2026-11-04' };

/** A query string without the undefined entries. */
export const qs = (o: Record<string, string | undefined>): string =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined)).toString();

/** Run counts with zeros for everything not given. */
export const counts = (c: Partial<RunCounts> = {}): RunCounts => ({ ...emptyRunCounts(), ...c });

export interface ReportBase {
  s: SignedUpTenant;
  owner: Api;
  branchTypeId: string;
  zoneTypeId: string;
}

/** A fresh tenant with its owner logged in. */
export async function reportBase(t: TestApp): Promise<ReportBase> {
  const s = await signupTenant(t);
  return { s, owner: as(t, s.accessToken), branchTypeId: await siteTypeIdOf(s.tenantId, 'Filial'), zoneTypeId: await siteTypeIdOf(s.tenantId, 'Zona') };
}

export async function addSite(b: ReportBase, name: string, parentId: string | null = null): Promise<string> {
  const res = await b.owner.post('/api/v1/sites', { parentId, typeId: parentId ? b.zoneTypeId : b.branchTypeId, name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

export interface ChecklistRef {
  id: string;
  versionId: string;
}

export async function addChecklist(b: ReportBase, name: string): Promise<ChecklistRef> {
  const id = await publishedChecklist(b.owner, name);
  const r = await ownerQuery<{ v: string }>('select current_version_id as v from checklists where id = $1', [id]);
  return { id, versionId: r.rows[0]!.v };
}

export interface ExecutionSpec {
  executor: string;
  state: 'active' | 'completed' | 'partial' | 'rejected';
  /** score.percent; null for a scoring-off checklist or no answers yet. */
  score: number | null;
  completedAt?: string;
  /** Defaults to completedAt (synced at once). */
  completedReceivedAt?: string;
  late?: boolean;
  clockSuspect?: boolean;
}

export interface RunSpec {
  date: string;
  siteId: string;
  checklist: ChecklistRef;
  status: OccurrenceStatus;
  dueAt: string;
  /** Defaults to 2 h before dueAt; the window closes 1 h after dueAt; executions start 10 min after it opens. */
  startsAt?: string;
  assignees: string[];
  executions?: ExecutionSpec[];
}

export interface AddedRun {
  occurrenceId: string;
  /** In RunSpec.executions order. */
  executionIds: string[];
}

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** One occurrence with its own (ended) assignment, so any number of runs can share a day; plus assignees and executions. */
export async function addRun(b: ReportBase, r: RunSpec): Promise<AddedRun> {
  const assignmentId = uuidv7();
  await ownerQuery(
    `insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, status, created_by_user_id)
     values ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb, 'ended', $5)`,
    [assignmentId, b.s.tenantId, r.checklist.id, r.siteId, b.s.ownerId],
  );
  const due = +new Date(r.dueAt);
  const starts = r.startsAt ? +new Date(r.startsAt) : due - 2 * HOUR;
  const occurrenceId = uuidv7();
  await ownerQuery(
    `insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status, cancel_reason, checklist_version_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [occurrenceId, b.s.tenantId, assignmentId, r.checklist.id, r.siteId, r.date, iso(starts), iso(due), iso(due + HOUR), r.status, r.status === 'cancelled' ? 'Test' : null, r.checklist.versionId],
  );
  for (const userId of r.assignees) {
    await ownerQuery('insert into occurrence_assignees (tenant_id, occurrence_id, user_id) values ($1, $2, $3)', [b.s.tenantId, occurrenceId, userId]);
  }
  const executionIds: string[] = [];
  for (const x of r.executions ?? []) {
    const id = uuidv7();
    await ownerQuery(
      `insert into executions (id, tenant_id, occurrence_id, checklist_version_id, executor_user_id, state, rejected_reason, started_at, started_received_at,
                               completed_at, completed_received_at, last_synced_at, progress, score, late, clock_suspect, device)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, coalesce($10::timestamptz, $8::timestamptz), '{"answered":1,"total":1,"requiredMissing":0}'::jsonb, $11::jsonb, $12, $13,
               '{"platform":"android","osVersion":"15","appVersion":"1.0.0"}'::jsonb)`,
      [
        id, b.s.tenantId, occurrenceId, r.checklist.versionId, x.executor, x.state, x.state === 'rejected' ? 'ALREADY_CLAIMED' : null, iso(starts + 10 * 60_000),
        x.completedAt ?? null, x.completedReceivedAt ?? x.completedAt ?? null, JSON.stringify({ earned: 0, possible: 0, percent: x.score, problems: [] }),
        x.late ?? false, x.clockSuspect ?? false,
      ],
    );
    executionIds.push(id);
  }
  return { occurrenceId, executionIds };
}

export interface ProblemSpec {
  run: AddedRun;
  siteId: string;
  checklistId: string;
  severity: 'normal' | 'critical';
  source?: 'rule' | 'manual';
  note?: string | null;
  createdAt: string;
}

/** A problem of the run's first (counted) execution, on a random item. */
export async function addProblem(b: ReportBase, p: ProblemSpec): Promise<string> {
  const id = uuidv7();
  await ownerQuery(
    `insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity, note, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [id, b.s.tenantId, p.run.executionIds[0], p.run.occurrenceId, p.siteId, p.checklistId, uuidv7(), p.source ?? 'rule', p.severity, p.note ?? null, p.createdAt],
  );
  return id;
}

export interface TaskSpec {
  title: string;
  status: TaskStatus;
  assigneeUserId: string;
  siteId?: string | null;
  dueAt?: string | null;
  createdAt: string;
  completedAt?: string | null;
  overdueAt?: string | null;
  problemId?: string | null;
}

/** A task created by the owner, straight in the DB. */
export async function addTask(b: ReportBase, x: TaskSpec): Promise<string> {
  const id = uuidv7();
  await ownerQuery(
    `insert into tasks (id, tenant_id, title, created_by_user_id, assignee_user_id, site_id, status, due_at, overdue_at, completed_at, cancelled_at, problem_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
      id, b.s.tenantId, x.title, b.s.ownerId, x.assigneeUserId, x.siteId ?? null, x.status, x.dueAt ?? null, x.overdueAt ?? null, x.completedAt ?? null,
      x.status === 'cancelled' ? x.createdAt : null, x.problemId ?? null, x.createdAt,
    ],
  );
  return id;
}

export interface Worker {
  id: string;
  username: string;
  secret: string;
}

export type RunKey = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9' | 'r10' | 'r11' | 'r12' | 'r13' | 'r14' | 'r15' | 'r16';
export type TaskKey = 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7' | 't8' | 't9' | 't10';

export interface ReportWorld extends ReportBase {
  sites: { branchA: string; zoneA1: string; zoneA2: string; branchB: string };
  checklists: { opening: ChecklistRef; stock: ChecklistRef };
  leyla: { id: string; api: Api };
  rauf: { id: string; api: Api };
  aynur: Worker;
  kamran: Worker;
  nigar: Worker;
  samir: Worker;
  runs: Record<RunKey, AddedRun>;
  problems: { p1: string; p2: string; p3: string; p4: string };
  tasks: Record<TaskKey, string>;
}

const D02 = '2026-11-02T06:00:00Z';
const D03 = '2026-11-03T06:00:00Z';
const D04 = '2026-11-04T06:00:00Z';

/** The spec §9 fixture tenant; see the table in Part 1 Task 8. */
export async function reportWorld(t: TestApp): Promise<ReportWorld> {
  const b = await reportBase(t);
  const branchA = await addSite(b, 'Filial A');
  const zoneA1 = await addSite(b, 'Zona A1', branchA);
  const zoneA2 = await addSite(b, 'Zona A2', branchA);
  const branchB = await addSite(b, 'Filial B');
  const opening = await addChecklist(b, 'Açılış yoxlaması');
  // Scoring off: its executions carry no score.
  const stock = await addChecklist(b, 'Anbar sayımı');

  const leyla = await staffAt(t, b.s.tenantId, b.owner, 'manager', [branchA], 'Leyla Quliyeva');
  const supervisor = await b.owner.post('/api/v1/roles', { name: 'Nəzarətçi', dataScope: 'subordinates', permissions: ['reports.view', 'assignments.view', 'tasks.view'] });
  expect(supervisor.status, JSON.stringify(supervisor.body)).toBe(201);
  const raufUser = await createUserDirect(t, b.s.tenantId, { kind: 'staff', roleId: supervisor.body.id as string, fullName: 'Rauf Kərimov', managerId: leyla.id, emailVerified: true });
  const rauf = { id: raufUser.id, api: as(t, (await loginStaff(t, raufUser.email!, raufUser.secret, 'web')).accessToken) };
  const worker = async (fullName: string, siteId: string | null, managerId: string | null, status: 'active' | 'deactivated' = 'active'): Promise<Worker> => {
    const u = await createUserDirect(t, b.s.tenantId, { fullName, managerId, status });
    if (siteId) expect((await b.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] })).status).toBe(200);
    return { id: u.id, username: u.username!, secret: u.secret };
  };
  const aynur = await worker('Aynur Quliyeva', zoneA1, rauf.id);
  const kamran = await worker('Kamran Əliyev', zoneA2, rauf.id);
  const nigar = await worker('Nigar Həsənova', branchB, null);
  const samir = await worker('Samir Məmmədov', null, rauf.id, 'deactivated');

  const done = (executor: Worker, score: number | null, completedAt: string, extra: Partial<ExecutionSpec> = {}): ExecutionSpec => ({ executor: executor.id, state: 'completed', score, completedAt, ...extra });
  const run = (date: string, siteId: string, status: OccurrenceStatus, dueAt: string, assignees: Worker[], executions: ExecutionSpec[] = [], extra: Partial<RunSpec> = {}) =>
    addRun(b, { date, siteId, checklist: opening, status, dueAt, assignees: assignees.map((a) => a.id), executions, ...extra });

  const runs: Record<RunKey, AddedRun> = {
    r1: await run('2026-11-02', zoneA1, 'completed', D02, [aynur], [done(aynur, 80, '2026-11-02T05:30:00Z')]),
    r2: await run('2026-11-02', zoneA2, 'completed', D02, [aynur, kamran, samir], [done(kamran, 100, '2026-11-02T05:40:00Z')]),
    r3: await run('2026-11-02', zoneA1, 'missed', D02, [aynur, kamran, samir]),
    r4: await run('2026-11-02', branchB, 'completed', D02, [nigar], [done(nigar, 60, '2026-11-02T05:50:00Z')]),
    r5: await run('2026-11-02', zoneA2, 'partial', D02, [kamran], [{ executor: kamran.id, state: 'partial', score: null }], { checklist: stock }),
    r6: await run('2026-11-02', branchA, 'cancelled', D02, [aynur]),
    // Done on Monday, synced from the phone on Wednesday: it still belongs to Monday (FR-10.13).
    r7: await run('2026-11-02', zoneA1, 'completed', D02, [aynur], [done(aynur, 90, '2026-11-02T07:00:00Z', { completedReceivedAt: '2026-11-04T05:00:00Z', late: true })]),
    r8: await run('2026-11-03', zoneA1, 'missed', D03, []),
    r9: await run('2026-11-03', zoneA2, 'completed', D03, [kamran], [done(kamran, 50, '2026-11-03T05:30:00Z', { clockSuspect: true })]),
    r10: await run('2026-11-03', branchB, 'missed', D03, [nigar], [], { checklist: stock }),
    r11: await run('2026-11-03', zoneA1, 'completed', D03, [samir], [done(samir, 70, '2026-11-03T05:30:00Z')]),
    r12: await run('2026-11-04', zoneA1, 'overdue', D04, [aynur]),
    r13: await run('2026-11-04', zoneA2, 'in_progress', '2026-11-04T10:00:00Z', [kamran], [{ executor: kamran.id, state: 'active', score: null }], { startsAt: '2026-11-04T07:00:00Z' }),
    r14: await run('2026-11-04', branchA, 'pending', '2026-11-04T10:00:00Z', [aynur]),
    // Finished before its due time: due and completed.
    r15: await run('2026-11-04', zoneA1, 'completed', '2026-11-04T12:00:00Z', [aynur], [done(aynur, 100, '2026-11-04T07:30:00Z')], { startsAt: '2026-11-04T05:00:00Z' }),
    // Kamran's claim won; Aynur's lost claim (score 10) must never count.
    r16: await run('2026-11-04', zoneA2, 'started', D04, [aynur, kamran], [
      { executor: kamran.id, state: 'active', score: null },
      { executor: aynur.id, state: 'rejected', score: 10 },
    ]),
  };

  const problems = {
    p1: await addProblem(b, { run: runs.r1, siteId: zoneA1, checklistId: opening.id, severity: 'normal', note: 'Qapı sınıqdır', createdAt: '2026-11-02T05:00:00Z' }),
    // A comma, quotes and a line break: the CSV round trip.
    p2: await addProblem(b, { run: runs.r4, siteId: branchB, checklistId: opening.id, severity: 'critical', source: 'manual', note: 'Kondisioner, "xarab"\nyenisi lazımdır', createdAt: '2026-11-02T05:10:00Z' }),
    // Looks like a formula: CSV must neutralise it.
    p3: await addProblem(b, { run: runs.r4, siteId: branchB, checklistId: opening.id, severity: 'normal', note: '=1+2', createdAt: '2026-11-02T05:20:00Z' }),
    p4: await addProblem(b, { run: runs.r9, siteId: zoneA2, checklistId: opening.id, severity: 'critical', note: null, createdAt: '2026-11-03T05:00:00Z' }),
  };

  const tasks: Record<TaskKey, string> = {
    t1: await addTask(b, { title: 'Qapını təmir et', status: 'new', assigneeUserId: aynur.id, siteId: zoneA1, dueAt: '2026-11-02T10:00:00Z', createdAt: '2026-11-01T08:00:00Z' }),
    t2: await addTask(b, { title: 'Rəfləri say', status: 'accepted', assigneeUserId: kamran.id, siteId: zoneA2, dueAt: '2026-11-03T10:00:00Z', createdAt: '2026-11-01T08:00:00Z' }),
    t3: await addTask(b, { title: 'Kondisioneri dəyiş', status: 'in_progress', assigneeUserId: nigar.id, siteId: branchB, dueAt: '2026-11-03T12:00:00Z', overdueAt: '2026-11-03T12:00:00Z', problemId: problems.p2, createdAt: '2026-11-02T08:00:00Z' }),
    t4: await addTask(b, { title: 'Hesabatı yoxla', status: 'awaiting_review', assigneeUserId: aynur.id, siteId: zoneA1, createdAt: '2026-11-03T05:00:00Z' }),
    t5: await addTask(b, { title: 'Ölçünü düzəlt', status: 'completed', assigneeUserId: nigar.id, siteId: branchB, dueAt: '2026-11-02T12:00:00Z', completedAt: '2026-11-02T11:00:00Z', problemId: problems.p3, createdAt: '2026-11-02T08:00:00Z' }),
    t6: await addTask(b, { title: 'Soyuducunu yoxla', status: 'completed', assigneeUserId: kamran.id, siteId: zoneA2, dueAt: '2026-11-03T08:00:00Z', completedAt: '2026-11-03T09:00:00Z', overdueAt: '2026-11-03T08:00:00Z', createdAt: '2026-11-02T08:00:00Z' }),
    t7: await addTask(b, { title: 'Termometri dəyiş', status: 'cancelled', assigneeUserId: kamran.id, siteId: zoneA2, dueAt: '2026-11-04T10:00:00Z', problemId: problems.p4, createdAt: '2026-11-03T08:00:00Z' }),
    t8: await addTask(b, { title: 'Açarları təhvil ver', status: 'completed', assigneeUserId: aynur.id, completedAt: '2026-11-04T05:00:00Z', createdAt: '2026-11-04T04:00:00Z' }),
    t9: await addTask(b, { title: 'Gələn həftə', status: 'new', assigneeUserId: aynur.id, siteId: zoneA1, dueAt: '2026-11-10T10:00:00Z', createdAt: '2026-11-03T08:00:00Z' }),
    // 21:30Z on 1 November is 01:30 on 2 November in Baku: inside the period.
    t10: await addTask(b, { title: 'Gecə yoxlaması', status: 'new', assigneeUserId: nigar.id, siteId: branchB, dueAt: '2026-11-01T21:30:00Z', createdAt: '2026-11-01T08:00:00Z' }),
  };

  return { ...b, sites: { branchA, zoneA1, zoneA2, branchB }, checklists: { opening, stock }, leyla: { id: leyla.id, api: leyla.api }, rauf, aynur, kamran, nigar, samir, runs, problems, tasks };
}

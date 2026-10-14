import type { ReportProblems, ReportTasks } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addProblem, addRun, addSite, addTask, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld, type TaskKey } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('GET /reports/problems and /reports/tasks', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const problems = async (api: Api, q: Record<string, string | undefined>): Promise<ReportProblems> => {
    const res = await api.get(`/api/v1/reports/problems?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ReportProblems;
  };
  const tasks = async (api: Api, q: Record<string, string | undefined>): Promise<ReportTasks> => {
    const res = await api.get(`/api/v1/reports/tasks?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ReportTasks;
  };
  const taskIds = (...keys: TaskKey[]) => keys.map((k) => w.tasks[k]);

  it('counts problems by severity and resolution and lists them newest first', async () => {
    const r = await problems(w.owner, PERIOD);
    expect(r.counts).toEqual({ total: 4, critical: 2, resolution: { none: 1, open: 1, resolved: 1, cancelled: 1 } });
    expect(r.items.map((p) => [p.id, p.severity, p.resolution, p.taskStatus])).toEqual([
      [w.problems.p4, 'critical', 'cancelled', 'cancelled'],
      [w.problems.p3, 'normal', 'resolved', 'completed'],
      [w.problems.p2, 'critical', 'open', 'in_progress'],
      [w.problems.p1, 'normal', 'none', null],
    ]);
    expect(r.items[2]).toMatchObject({
      localDate: '2026-11-02', siteName: 'Filial B', checklistName: 'Açılış yoxlaması', source: 'manual',
      note: 'Kondisioner, "xarab"\nyenisi lazımdır', executorName: 'Nigar Həsənova', taskId: w.tasks.t3, occurrenceId: w.runs.r4.occurrenceId,
    });
    expect(r.nextCursor).toBeNull();
  });

  it('filters problems by severity (the dashboard’s critical panel), employee and site subtree', async () => {
    const critical = await problems(w.owner, { ...PERIOD, severity: 'critical' });
    expect(critical.counts).toEqual({ total: 2, critical: 2, resolution: { none: 0, open: 1, resolved: 0, cancelled: 1 } });
    expect(critical.items.map((p) => p.id)).toEqual([w.problems.p4, w.problems.p2]);
    expect((await problems(w.owner, { ...PERIOD, userId: w.nigar.id })).items.map((p) => p.id)).toEqual([w.problems.p3, w.problems.p2]);
    expect((await problems(w.owner, { ...PERIOD, siteId: w.sites.branchA })).items.map((p) => p.id)).toEqual([w.problems.p4, w.problems.p1]);
    expect((await problems(w.owner, { from: '2026-11-03', to: '2026-11-03' })).counts.total).toBe(1);
  });

  it('pages problems with the /problems cursor, keeping the counts on every page', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    const run = await addRun(b, { date: '2026-11-03', siteId: site, checklist, status: 'completed', dueAt: '2026-11-03T06:00:00Z', assignees: [worker.id], executions: [{ executor: worker.id, state: 'completed', score: 10, completedAt: '2026-11-03T05:00:00Z' }] });
    const created: string[] = [];
    for (let i = 0; i < 52; i++) created.push(await addProblem(b, { run, siteId: site, checklistId: checklist.id, severity: 'normal', createdAt: '2026-11-03T05:00:00Z' }));
    const first = await problems(b.owner, PERIOD);
    expect([first.items.length, first.counts.total]).toEqual([50, 52]);
    const second = await problems(b.owner, { ...PERIOD, cursor: first.nextCursor! });
    expect([second.items.length, second.counts.total, second.nextCursor]).toEqual([2, 52, null]);
    expect([...first.items, ...second.items].map((p) => p.id)).toEqual([...created].reverse());
  });

  it('counts the period’s tasks by status, overdue and on time (spec §3.4), by their local due day', async () => {
    const r = await tasks(w.owner, PERIOD);
    expect(r.counts).toEqual({
      byStatus: { new: 2, accepted: 1, in_progress: 1, awaiting_review: 1, completed: 3, cancelled: 1 },
      overdueOpen: 1,
      completedOnTime: 2,
      completedLate: 1,
    });
    // By due time (creation time when there is none), newest first; t9 is due next week.
    expect(r.items.map((x) => x.id)).toEqual(taskIds('t7', 't8', 't3', 't2', 't6', 't4', 't5', 't1', 't10'));
    expect(r.items.find((x) => x.id === w.tasks.t6)).toEqual({
      id: w.tasks.t6, title: 'Soyuducunu yoxla', priority: 'normal', status: 'completed',
      site: { id: w.sites.zoneA2, name: 'Zona A2' }, assignee: { id: w.kamran.id, fullName: 'Kamran Əliyev' }, team: null,
      dueAt: '2026-11-03T08:00:00.000Z', completedAt: '2026-11-03T09:00:00.000Z', createdAt: '2026-11-02T08:00:00.000Z', overdue: true, problemId: null,
    });
    expect(r.nextCursor).toBeNull();
  });

  it('filters tasks by site subtree, assignee and the checklist of their problem', async () => {
    expect((await tasks(w.owner, { ...PERIOD, siteId: w.sites.branchB })).items.map((x) => x.id)).toEqual(taskIds('t3', 't5', 't10'));
    expect((await tasks(w.owner, { ...PERIOD, userId: w.aynur.id })).items.map((x) => x.id)).toEqual(taskIds('t8', 't4', 't1'));
    expect((await tasks(w.owner, { ...PERIOD, checklistId: w.checklists.opening.id })).items.map((x) => x.id)).toEqual(taskIds('t7', 't3', 't5'));
    expect((await tasks(w.owner, { ...PERIOD, checklistId: w.checklists.stock.id })).items).toEqual([]);
  });

  it('places a task by its due time’s local day in the tenant timezone (Europe/Berlin, DST end)', async () => {
    const b = await reportBase(t);
    await ownerQuery("update tenants set timezone = 'Europe/Berlin' where id = $1", [b.s.tenantId]);
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    const task = (dueAt: string) => addTask(b, { title: dueAt, status: 'new', assigneeUserId: worker.id, dueAt, createdAt: '2026-10-20T08:00:00Z' });
    // 22:30Z on the 24th is 00:30 on the 25th in Berlin (CEST, UTC+2).
    const early = await task('2026-10-24T22:30:00Z');
    // 21:30Z on the 25th is 22:30 the same day in Berlin (CET, UTC+1), but already the 26th in Baku.
    const mid = await task('2026-10-25T21:30:00Z');
    // 23:30Z on the 25th is 00:30 on the 26th in Berlin.
    const late = await task('2026-10-25T23:30:00Z');
    const day = async (d: string) => (await tasks(b.owner, { from: d, to: d })).items.map((x) => x.id);
    expect(await day('2026-10-24')).toEqual([]);
    expect(await day('2026-10-25')).toEqual([mid, early]);
    expect(await day('2026-10-26')).toEqual([late]);
  });
});

import type { EmployeeReportRow, Page, ReportProblems, ReportRun, ReportSummary, ReportTasks, SiteReportRow } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld, type RunKey, type TaskKey } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('report data scope (spec §4)', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const get = async <T>(api: Api, path: string, q: Record<string, string | undefined> = {}): Promise<T> => {
    const res = await api.get(`/api/v1/reports/${path}?${qs({ ...PERIOD, ...q })}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as T;
  };
  const planned = async (api: Api, q: Record<string, string | undefined> = {}) => (await get<ReportSummary>(api, 'summary', q)).counts.planned;
  const runIds = async (api: Api) => (await get<Page<ReportRun>>(api, 'runs')).items.map((r) => r.occurrenceId).sort();
  const runs = (...keys: RunKey[]) => keys.map((k) => w.runs[k].occurrenceId).sort();
  const tasks = (...keys: TaskKey[]) => keys.map((k) => w.tasks[k]);
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('shows a site_subtree manager only their branch and its zones', async () => {
    const api = w.leyla.api;
    expect(await planned(api)).toBe(13);
    expect(await runIds(api)).toEqual(runs('r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'r8', 'r9', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16'));
    expect(names(await get<SiteReportRow[]>(api, 'sites'))).toEqual(['Filial A', 'Zona A1', 'Zona A2']);
    expect(names(await get<EmployeeReportRow[]>(api, 'employees'))).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Samir Məmmədov', 'Təyin edilməyib']);
    const problems = await get<ReportProblems>(api, 'problems');
    expect([problems.counts.total, problems.items.map((p) => p.id)]).toEqual([2, [w.problems.p4, w.problems.p1]]);
    // Tasks at her sites, or assigned to people at her sites (TaskScope): t8 has no site but Aynur works at Zona A1.
    expect((await get<ReportTasks>(api, 'tasks')).items.map((x) => x.id)).toEqual(tasks('t7', 't8', 't2', 't6', 't4', 't1'));
  });

  it('shows a subordinates manager only the runs of their people', async () => {
    const api = w.rauf.api;
    expect(await planned(api)).toBe(12);
    expect(await runIds(api)).toEqual(runs('r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'r9', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16'));
    expect(names(await get<EmployeeReportRow[]>(api, 'employees'))).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Samir Məmmədov']);
    expect((await get<ReportProblems>(api, 'problems')).items.map((p) => p.id)).toEqual([w.problems.p4, w.problems.p1]);
    expect((await get<ReportTasks>(api, 'tasks')).items.map((x) => x.id)).toEqual(tasks('t7', 't8', 't2', 't6', 't4', 't1'));
  });

  it('treats filters outside the scope as empty, not forbidden', async () => {
    expect(await planned(w.leyla.api, { siteId: w.sites.branchB })).toBe(0);
    expect(await planned(w.leyla.api, { userId: w.nigar.id })).toBe(0);
    expect(await get<SiteReportRow[]>(w.leyla.api, 'sites', { siteId: w.sites.branchB })).toEqual([]);
    expect((await get<ReportProblems>(w.leyla.api, 'problems', { userId: w.nigar.id })).counts.total).toBe(0);
    expect((await get<ReportTasks>(w.leyla.api, 'tasks', { siteId: w.sites.branchB })).items).toEqual([]);
    expect(await planned(w.rauf.api, { userId: w.nigar.id })).toBe(0);
    expect(await planned(w.owner, { siteId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f' })).toBe(0);
  });

  it('limits an own-scope report viewer to their own runs and tasks', async () => {
    const own = await w.owner.post('/api/v1/roles', { name: 'Öz hesabatı', dataScope: 'own', permissions: ['reports.view'] });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    await ownerQuery('update users set role_id = $1 where id = $2', [own.body.id, w.aynur.id]);
    try {
      const api = as(t, (await loginWorker(t, w.s.orgCode, w.aynur.username, w.aynur.secret)).accessToken);
      // Runs she is assigned to: r1, r2, r3, r7, r12, r14, r15, r16 (and the cancelled r6).
      expect(await planned(api)).toBe(8);
      // Without tasks.view: only tasks assigned to her (t9 is outside the period).
      expect((await get<ReportTasks>(api, 'tasks')).items.map((x) => x.id)).toEqual(tasks('t8', 't4', 't1'));
    } finally {
      await ownerQuery("update users set role_id = (select id from roles where tenant_id = $1 and system_key = 'worker') where id = $2", [w.s.tenantId, w.aynur.id]);
    }
  });

  it('refuses every report without reports.view', async () => {
    const worker = as(t, (await loginWorker(t, w.s.orgCode, w.kamran.username, w.kamran.secret)).accessToken);
    for (const path of ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks']) {
      expect((await worker.get(`/api/v1/reports/${path}?${qs(PERIOD)}`)).status, path).toBe(403);
    }
    const noReports = await w.owner.post('/api/v1/roles', { name: 'Təyinatlar', dataScope: 'all', permissions: ['assignments.view', 'tasks.view'] });
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: noReports.body.id as string, emailVerified: true });
    const api = as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    expect((await api.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(403);
  });

  it('never shows another tenant’s runs', async () => {
    const other = await reportBase(t);
    expect(await planned(other.owner)).toBe(0);
    expect(await get<SiteReportRow[]>(other.owner, 'sites', { siteId: w.sites.zoneA1 })).toEqual([]);
  });
});

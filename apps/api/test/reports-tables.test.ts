import type { EmployeeReportRow, SiteReportRow } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addRun, addSite, counts, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('GET /reports/sites and /reports/employees', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const sites = async (api: Api, q: Record<string, string | undefined>): Promise<SiteReportRow[]> => {
    const res = await api.get(`/api/v1/reports/sites?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as SiteReportRow[];
  };
  const employees = async (api: Api, q: Record<string, string | undefined>): Promise<EmployeeReportRow[]> => {
    const res = await api.get(`/api/v1/reports/employees?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as EmployeeReportRow[];
  };

  it('compares the sites that had planned runs, in tree order with their ancestors', async () => {
    expect(await sites(w.owner, PERIOD)).toEqual([
      // Only the pending r14 (r6 is cancelled): planned, not due yet.
      { siteId: w.sites.branchA, name: 'Filial A', path: [], active: true, ...counts({ planned: 1, pending: 1 }), completionPercent: null, averageScore: null },
      { siteId: w.sites.zoneA1, name: 'Zona A1', path: ['Filial A'], active: true, ...counts({ planned: 7, due: 7, completed: 4, overdue: 1, missed: 2, withProblems: 1 }), completionPercent: 57.1, averageScore: 85 },
      { siteId: w.sites.zoneA2, name: 'Zona A2', path: ['Filial A'], active: true, ...counts({ planned: 5, due: 4, completed: 2, inProgress: 2, partial: 1, withProblems: 1, withCritical: 1 }), completionPercent: 50, averageScore: 75 },
      { siteId: w.sites.branchB, name: 'Filial B', path: [], active: true, ...counts({ planned: 2, due: 2, completed: 1, missed: 1, withProblems: 1, withCritical: 1 }), completionPercent: 50, averageScore: 60 },
    ]);
  });

  it('attributes executed runs to the executor only and unexecuted runs to every assignee (spec §3.3)', async () => {
    const rows = await employees(w.owner, PERIOD);
    expect(rows).toEqual([
      // r1, r7, r15 done; r3 shared and missed; r12 overdue; r14 pending. Not r16: her claim lost.
      { userId: w.aynur.id, name: 'Aynur Quliyeva', active: true, ...counts({ planned: 6, due: 5, completed: 3, pending: 1, overdue: 1, missed: 1, withProblems: 1 }), completionPercent: 60, averageScore: 90 },
      // r2 (shared, done by him), r5, r9, r13, r16; and the shared missed r3.
      { userId: w.kamran.id, name: 'Kamran Əliyev', active: true, ...counts({ planned: 6, due: 5, completed: 2, inProgress: 2, partial: 1, missed: 1, withProblems: 1, withCritical: 1 }), completionPercent: 40, averageScore: 75 },
      { userId: w.nigar.id, name: 'Nigar Həsənova', active: true, ...counts({ planned: 2, due: 2, completed: 1, missed: 1, withProblems: 1, withCritical: 1 }), completionPercent: 50, averageScore: 60 },
      // Deactivated: history kept, marked inactive (FR-04.11).
      { userId: w.samir.id, name: 'Samir Məmmədov', active: false, ...counts({ planned: 2, due: 2, completed: 1, missed: 1 }), completionPercent: 50, averageScore: 70 },
      { userId: null, name: 'Təyin edilməyib', active: true, ...counts({ planned: 1, due: 1, missed: 1 }), completionPercent: 0, averageScore: null },
    ]);
    // The shared missed r3 counts three times: 17 planned against the sites' 15.
    expect(rows.reduce((n, r) => n + r.planned, 0)).toBe(17);
  });

  it('narrows both tables by employee, and never matches the Unassigned row', async () => {
    expect((await employees(w.owner, { ...PERIOD, userId: w.kamran.id })).map((r) => [r.name, r.planned])).toEqual([['Kamran Əliyev', 6]]);
    expect((await sites(w.owner, { ...PERIOD, userId: w.kamran.id })).map((r) => [r.name, r.planned])).toEqual([['Zona A1', 1], ['Zona A2', 5]]);
    expect((await employees(w.owner, { ...PERIOD, siteId: w.sites.zoneA1 })).map((r) => [r.name, r.planned])).toEqual([
      ['Aynur Quliyeva', 5], ['Kamran Əliyev', 1], ['Samir Məmmədov', 2], ['Təyin edilməyib', 1],
    ]);
  });

  it('follows a site moved in the tree: the subtree filter and the ancestor names use where it is now', async () => {
    const b = await reportBase(t);
    const north = await addSite(b, 'Şimal');
    const south = await addSite(b, 'Cənub');
    const zone = await addSite(b, 'Zona 1', north);
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    await addRun(b, { date: '2026-11-03', siteId: zone, checklist, status: 'completed', dueAt: '2026-11-03T06:00:00Z', assignees: [worker.id], executions: [{ executor: worker.id, state: 'completed', score: 100, completedAt: '2026-11-03T05:00:00Z' }] });
    expect((await sites(b.owner, { ...PERIOD, siteId: north })).map((r) => r.path)).toEqual([['Şimal']]);
    expect((await b.owner.post(`/api/v1/sites/${zone}/move`, { parentId: south })).status).toBe(200);
    await ownerQuery('update sites set active = false where id = $1', [zone]);
    expect(await sites(b.owner, { ...PERIOD, siteId: north })).toEqual([]);
    expect((await sites(b.owner, { ...PERIOD, siteId: south })).map((r) => [r.name, r.path, r.active, r.completed])).toEqual([['Zona 1', ['Cənub'], false, 1]]);
  });
});

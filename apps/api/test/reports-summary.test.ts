import { completionPercent, OCCURRENCE_STATUSES, type OccurrenceStatus, type ReportSummary, tallyRuns } from '@taskop/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { ReportQueries } from '../src/reports/report-queries';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addRun, addSite, counts, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

const summary = async (api: Api, q: Record<string, string | undefined>): Promise<ReportSummary> => {
  const res = await api.get(`/api/v1/reports/summary?${qs(q)}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ReportSummary;
};

describe('GET /reports/summary', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  it('counts the period’s runs by bucket, with completion and average score (spec §3.1)', async () => {
    expect(await summary(w.owner, PERIOD)).toEqual({
      counts: counts({ planned: 15, due: 13, completed: 7, inProgress: 2, pending: 1, overdue: 1, partial: 1, missed: 3, withProblems: 3, withCritical: 2 }),
      completionPercent: 53.8,
      // 80, 100, 60, 90, 50, 70, 100: the scoring-off and open runs have no score, and Aynur's lost claim (10) is ignored.
      averageScore: 78.6,
      trend: [
        { date: '2026-11-02', due: 6, completed: 4, completionPercent: 66.7 },
        { date: '2026-11-03', due: 4, completed: 2, completionPercent: 50 },
        // r15 finished early: due and completed; r13 and r14 are not due yet.
        { date: '2026-11-04', due: 3, completed: 1, completionPercent: 33.3 },
      ],
    });
  });

  it('agrees with classifyRun on the same rows (cross-check)', async () => {
    const rows = await ownerQuery<{ status: OccurrenceStatus; due_at: Date; local_date: string; has_problems: boolean; has_critical: boolean }>(
      `select o.status, o.due_at, to_char(o.local_date, 'YYYY-MM-DD') as local_date,
              exists (select 1 from execution_problems p where p.occurrence_id = o.id) as has_problems,
              exists (select 1 from execution_problems p where p.occurrence_id = o.id and p.severity = 'critical') as has_critical
         from occurrences o where o.tenant_id = $1 and o.local_date between $2 and $3`,
      [w.s.tenantId, PERIOD.from, PERIOD.to],
    );
    const facts = rows.rows.map((r) => ({ status: r.status, dueAt: r.due_at, hasProblems: r.has_problems, hasCritical: r.has_critical, date: r.local_date }));
    const now = new Date(REPORT_NOW);
    const s = await summary(w.owner, PERIOD);
    expect(s.counts).toEqual(tallyRuns(facts, now));
    expect(s.completionPercent).toBe(completionPercent(s.counts.completed, s.counts.due));
    for (const day of s.trend) {
      const c = tallyRuns(facts.filter((f) => f.date === day.date), now);
      expect(day, day.date).toEqual({ date: day.date, due: c.due, completed: c.completed, completionPercent: completionPercent(c.completed, c.due) });
    }
  });

  it('agrees with classifyRun for every status, due or not yet due', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    const executionState: Partial<Record<OccurrenceStatus, 'active' | 'completed' | 'partial'>> = {
      started: 'active', in_progress: 'active', completed: 'completed', partial: 'partial', audit_pending: 'completed', audited: 'completed',
    };
    const facts: { status: OccurrenceStatus; dueAt: string; hasProblems: boolean; hasCritical: boolean }[] = [];
    for (const status of OCCURRENCE_STATUSES) {
      for (const dueAt of ['2026-11-04T06:00:00Z', '2026-11-04T10:00:00Z']) {
        const state = executionState[status];
        await addRun(b, { date: '2026-11-04', siteId: site, checklist, status, dueAt, assignees: [worker.id], executions: state ? [{ executor: worker.id, state, score: 50 }] : [] });
        facts.push({ status, dueAt, hasProblems: false, hasCritical: false });
      }
    }
    expect((await summary(b.owner, { from: '2026-11-04', to: '2026-11-04' })).counts).toEqual(tallyRuns(facts, new Date(REPORT_NOW)));
  });

  it('narrows by site subtree, checklist and employee (spec §3.3, §4)', async () => {
    expect((await summary(w.owner, { ...PERIOD, siteId: w.sites.branchA })).counts.planned).toBe(13);
    expect((await summary(w.owner, { ...PERIOD, siteId: w.sites.zoneA1 })).counts.planned).toBe(7);
    expect((await summary(w.owner, { ...PERIOD, checklistId: w.checklists.stock.id })).counts).toEqual(counts({ planned: 2, due: 2, partial: 1, missed: 1 }));
    // Aynur: her three completions, the shared missed run, the overdue and the pending one; not r16 (her claim lost), not r6 (cancelled).
    expect(await summary(w.owner, { ...PERIOD, userId: w.aynur.id })).toMatchObject({
      counts: counts({ planned: 6, due: 5, completed: 3, pending: 1, overdue: 1, missed: 1, withProblems: 1 }),
      completionPercent: 60,
      averageScore: 90,
    });
    expect((await summary(w.owner, { ...PERIOD, siteId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f' })).counts).toEqual(counts());
  });

  it('answers zeros, no percentages and one entry per day for an empty period', async () => {
    expect(await summary(w.owner, { from: '2026-12-01', to: '2026-12-03' })).toEqual({
      counts: counts(),
      completionPercent: null,
      averageScore: null,
      trend: ['2026-12-01', '2026-12-02', '2026-12-03'].map((date) => ({ date, due: 0, completed: 0, completionPercent: null })),
    });
  });

  it('keeps one trend entry per calendar day across a DST change (Europe/Berlin)', async () => {
    const b = await reportBase(t);
    await ownerQuery("update tenants set timezone = 'Europe/Berlin' where id = $1", [b.s.tenantId]);
    const site = await addSite(b, 'Berlin');
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    // 23:30 on the 25-hour day 25 October (CET, UTC+1): the run's day is its stored local_date.
    await addRun(b, { date: '2026-10-25', siteId: site, checklist, status: 'missed', dueAt: '2026-10-25T22:30:00Z', startsAt: '2026-10-25T21:30:00Z', assignees: [worker.id] });
    const s = await summary(b.owner, { from: '2026-10-24', to: '2026-10-27' });
    expect(s.trend.map((d) => [d.date, d.due])).toEqual([['2026-10-24', 0], ['2026-10-25', 1], ['2026-10-26', 0], ['2026-10-27', 0]]);
  });

  it('validates the range (spec §5.2)', async () => {
    const get = (q: Record<string, string>) => w.owner.get(`/api/v1/reports/summary?${qs(q)}`);
    expect((await get({ from: '2026-01-01', to: '2027-01-01' })).status).toBe(200);
    const long = await get({ from: '2026-01-01', to: '2027-01-02' });
    expect([long.status, long.body.error.code]).toEqual([400, 'REPORT_RANGE_TOO_LONG']);
    const inverted = await get({ from: '2026-11-04', to: '2026-11-02' });
    expect([inverted.status, inverted.body.error.code, inverted.body.error.fields]).toEqual([400, 'VALIDATION_FAILED', { to: 'reports.issues.toBeforeFrom' }]);
    expect((await get({ from: '2026-11-02' })).status).toBe(400);
    expect((await get({ from: '2026-11-31', to: '2026-12-01' })).status).toBe(400);
  });

  it('needs reports.view', async () => {
    const worker = as(t, (await loginWorker(t, w.s.orgCode, w.aynur.username, w.aynur.secret)).accessToken);
    expect((await worker.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(403);
  });
});

describe('report statement timeout (spec §5.5)', () => {
  it('maps a cancelled statement to 503 REPORT_TIMEOUT', async () => {
    const t = await createTestApp({ REPORTS_STATEMENT_TIMEOUT_MS: '200' });
    try {
      const b = await reportBase(t);
      const spy = vi.spyOn(t.app.get(ReportQueries), 'summary').mockImplementationOnce(async () => {
        await t.app.get(DbService).tx().execute(sql`select pg_sleep(2)`);
        throw new Error('pg_sleep should have been cancelled');
      });
      const res = await b.owner.get(`/api/v1/reports/summary?${qs(PERIOD)}`);
      expect([res.status, res.body.error.code]).toEqual([503, 'REPORT_TIMEOUT']);
      expect(spy).toHaveBeenCalledOnce();
      // The next request has its own transaction and works.
      expect((await b.owner.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});

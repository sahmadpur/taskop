import { parse } from 'csv-parse/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { auditWorld, correct, markUploaded, sendBack, startAudit, verdictAll, withdraw } from './audit-fixtures';
import { FakeClock } from './fake-clock';
import { staffAt } from './notification-fixtures';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems, insertTaskRow } from './task-fixtures';

const DAY = { from: '2026-11-02', to: '2026-11-02' };
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('reports after audits and corrections (spec §3.1, §8.3)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const runs = async (api: Api, extra: Record<string, string> = {}) => {
    const res = await api.get(`/api/v1/reports/runs?${q({ ...DAY, ...extra })}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items as { occurrenceId: string; status: string; auditState: string | null; corrected: boolean; completedAt: string; late: boolean }[];
  };

  it('counts a sent-back run as completed, with its first completion time', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set('2026-11-02T12:00:00Z');
    const summary = (await a.w.owner.get(`/api/v1/reports/summary?${q(DAY)}`)).body;
    expect(summary.counts).toMatchObject({ completed: 1 });
    expect(await runs(a.w.owner, { bucket: 'completed' })).toEqual([
      expect.objectContaining({ occurrenceId: a.w.occurrenceId, status: 'correction_required', completedAt: '2026-11-02T04:20:00.000Z', late: false }),
    ]);
  });

  it('a send-back then a withdrawal, with no correction, leaves the run not corrected (ruling F4)', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    expect((await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] })).status).toBe(200);
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    expect((await runs(a.w.owner))[0]).toMatchObject({ occurrenceId: a.w.occurrenceId, corrected: false });
    const detail = await a.manager.api.get(`/api/v1/executions/${a.executionId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({ corrected: false, rework: null });
    const fix = await correct(a.manager.api, a.executionId, { answersRev: 2, changes: [{ itemId: a.w.c.note.id, answer: { text: 'Qeyd' } }], reason: 'Qeyd unudulmuşdu' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect((await runs(a.w.owner))[0]).toMatchObject({ corrected: true });
    expect((await a.manager.api.get(`/api/v1/executions/${a.executionId}`)).body).toMatchObject({ corrected: true });
  });

  it('report problem counts skip cleared problems', async () => {
    const { w, executionId, ruleProblemId, manualProblemId } = await closedRunWithProblems(t, clock);
    await insertTaskRow({ tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId: ruleProblemId });
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    const problems = async () => (await w.owner.get(`/api/v1/reports/problems?${q(DAY)}`)).body;
    expect((await problems()).counts).toMatchObject({ total: 2, critical: 1 });
    clock.set('2026-11-02T05:00:00Z');
    const fix = await correct(manager.api, executionId, { answersRev: 1, changes: [{ itemId: w.c.temp.id, answer: { number: 5, note: 'normal' } }], reason: 'Səhv' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    const after = await problems();
    expect(after.counts).toMatchObject({ total: 1, critical: 1, resolution: { none: 1, open: 0, resolved: 0, cancelled: 0 } });
    expect(after.items.map((p: { id: string }) => p.id)).toEqual([manualProblemId]);
    const [run] = await runs(w.owner);
    expect(run).toMatchObject({ problemCount: 1, criticalCount: 1, corrected: true });
    expect((await w.owner.get(`/api/v1/reports/summary?${q(DAY)}`)).body.counts).toMatchObject({ withProblems: 1, withCritical: 1 });
  });

  it('shows the audit state and the corrected marker on runs, filters by them and exports them', async () => {
    const a = await auditWorld(t, clock, { requiresAudit: true });
    expect((await runs(a.w.owner))[0]).toMatchObject({ auditState: 'waiting', corrected: false });
    clock.set('2026-11-02T05:00:00Z');
    await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'Hər şey qaydasındadır' } }], reason: 'Qeyd unudulmuşdu' });
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    expect((await runs(a.w.owner))[0]).toMatchObject({ auditState: 'in_progress', corrected: true });
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id], [a.w.c.temp.id]);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, { result: 'failed' })).status).toBe(200);
    expect((await runs(a.w.owner))[0]).toMatchObject({ status: 'audited', auditState: 'failed' });
    expect((await runs(a.w.owner, { auditState: 'failed' })).map((r) => r.occurrenceId)).toEqual([a.w.occurrenceId]);
    expect(await runs(a.w.owner, { auditState: 'passed' })).toEqual([]);
    expect(await runs(a.w.owner, { auditState: 'waiting' })).toEqual([]);

    const csv = await a.w.owner.get(`/api/v1/reports/runs/export?${q({ ...DAY, format: 'csv', auditState: 'failed' })}`).responseType('blob');
    expect(csv.status).toBe(200);
    const rows = parse((csv.body as Buffer).toString('utf8'), { bom: true }) as string[][];
    expect(rows[0]!.slice(-2)).toEqual(['Audit', 'Düzəliş edilib']);
    expect(rows[1]!.slice(-2)).toEqual(['Audit uğursuz', 'Bəli']);
  });
});

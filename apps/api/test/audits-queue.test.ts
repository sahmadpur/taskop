import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type Staff, completeRunOn, startAudit, verdictAll } from './audit-fixtures';
import { type ExecutionWorld, executionWorld } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

describe('the audit queue (GET /audits, Spec decision 13)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: ExecutionWorld;
  let auditor: Staff;
  const runs: Record<string, { occurrenceId: string; executionId: string }> = {};
  const auditIds: Record<string, string> = {};

  /** Four runs of a checklist that requires audit, completed on 2–5 November: d2 waits, d3 is being audited, d4 passed, d5 failed. */
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await executionWorld(t);
    await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
    const s = await staffAt(t, w.s.tenantId, w.owner, 'auditor', [], 'Auditor');
    auditor = { id: s.id, api: s.api };
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) runs[d] = await completeRunOn(t, clock, w, d);
    const items = [w.c.problem.id, w.c.temp.id, w.c.photo.id, w.c.note.id];
    for (const [d, minute] of [['2026-11-03', '10'], ['2026-11-04', '11'], ['2026-11-05', '12']] as const) {
      clock.set(`2026-11-06T06:${minute}:00Z`);
      const res = await startAudit(auditor.api, runs[d]!.executionId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      auditIds[d] = res.body.id as string;
    }
    for (const [d, result, minute] of [['2026-11-04', 'passed', '20'], ['2026-11-05', 'failed', '30']] as const) {
      await verdictAll(auditor.api, auditIds[d]!, items, result === 'failed' ? [w.c.temp.id] : []);
      clock.set(`2026-11-06T06:${minute}:00Z`);
      expect((await auditor.api.post(`/api/v1/audits/${auditIds[d]}/finish`, { result })).status).toBe(200);
    }
  });
  beforeEach(() => clock.set('2026-11-06T08:00:00Z'));
  afterAll(() => t.close());

  const page = async (api: Api, query: string) => {
    const res = await api.get(`/api/v1/audits?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { items: { occurrenceId: string }[]; nextCursor: string | null };
  };
  const ids = (p: { items: { occurrenceId: string }[] }) => p.items.map((r) => r.occurrenceId);
  const of = (...days: string[]) => days.map((d) => runs[d]!.occurrenceId);

  it('lists the waiting, in-progress and finished runs, each in its order', async () => {
    expect(ids(await page(auditor.api, 'queue=waiting'))).toEqual(of('2026-11-02'));
    expect(ids(await page(auditor.api, 'queue=in_progress'))).toEqual(of('2026-11-03'));
    expect(ids(await page(auditor.api, 'queue=finished'))).toEqual(of('2026-11-05', '2026-11-04'));
  });

  it('returns the run and audit columns of a row', async () => {
    const [row] = (await page(auditor.api, 'queue=finished&result=failed')).items;
    expect(row).toEqual({
      occurrenceId: runs['2026-11-05']!.occurrenceId,
      executionId: runs['2026-11-05']!.executionId,
      auditId: auditIds['2026-11-05'],
      checklist: { id: w.checklistId, name: 'İcra yoxlaması' },
      site: { id: w.siteId, name: 'Filial 1' },
      executor: { id: w.workers[0].id, fullName: 'İşçi 1' },
      localDate: '2026-11-05',
      completedAt: '2026-11-05T04:20:00.000Z',
      status: 'audited',
      auditState: 'failed',
      auditor: { kind: 'user', id: auditor.id, name: 'Auditor' },
      result: 'failed',
      percent: 75,
      startedAt: '2026-11-06T06:12:00.000Z',
      finishedAt: '2026-11-06T06:30:00.000Z',
    });
    expect((await page(auditor.api, 'queue=waiting')).items[0]).toMatchObject({ auditId: null, auditState: 'waiting', auditor: null, result: null, percent: null, status: 'audit_pending' });
  });

  it('filters by result, dates, site, checklist and auditor', async () => {
    expect(ids(await page(auditor.api, 'queue=finished&result=passed'))).toEqual(of('2026-11-04'));
    expect(ids(await page(auditor.api, 'queue=finished&from=2026-11-04&to=2026-11-04'))).toEqual(of('2026-11-04'));
    expect(ids(await page(auditor.api, `queue=finished&siteId=${w.otherSiteId}`))).toEqual([]);
    expect(ids(await page(auditor.api, `queue=finished&siteId=${w.siteId}&checklistId=${w.checklistId}`))).toEqual(of('2026-11-05', '2026-11-04'));
    expect(ids(await page(auditor.api, `queue=finished&auditorId=${auditor.id}`))).toEqual(of('2026-11-05', '2026-11-04'));
    expect(ids(await page(auditor.api, `queue=finished&auditorId=${w.s.ownerId}`))).toEqual([]);
    const long = await auditor.api.get('/api/v1/audits?queue=finished&from=2026-01-01&to=2027-01-02');
    expect([long.status, long.body.error.fields]).toEqual([400, { to: 'audits.issues.rangeTooLong' }]);
  });

  it('pages with a cursor', async () => {
    const first = await page(auditor.api, 'queue=finished&limit=1');
    expect([ids(first), first.nextCursor]).toEqual([of('2026-11-05'), runs['2026-11-05']!.occurrenceId]);
    const second = await page(auditor.api, `queue=finished&limit=1&cursor=${first.nextCursor}`);
    expect([ids(second), second.nextCursor]).toEqual([of('2026-11-04'), null]);
  });

  it('follows the data scope and needs audits.perform', async () => {
    const role = await w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope: 'site_subtree', permissions: ['audits.perform'] });
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: role.body.id, emailVerified: true });
    expect((await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    const elsewhere = as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    expect(ids(await page(elsewhere, 'queue=finished'))).toEqual([]);
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    expect((await manager.api.get('/api/v1/audits?queue=waiting')).status).toBe(403);
  });
});

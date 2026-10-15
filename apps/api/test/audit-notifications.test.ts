import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditWorld, markUploaded, resubmit, sendBack, startAudit, verdictAll } from './audit-fixtures';
import { answersBody } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { addDevice, deliveriesOf, eventRows, fanOutAll, inboxOf } from './notification-fixtures';
import { MONDAY_0800 } from './scheduling-fixtures';

const LATER = '2026-11-02T12:00:00.000Z';

describe('audit and correction notifications (spec §7.1)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const only = async (userId: string, type: string) => (await inboxOf(userId)).filter((n) => n.type === type);

  /** Finishes an audit with the temperature rejected (failed, 75 %) or everything approved (passed, 100 %). */
  async function finishAudit(a: AuditWorld, result: 'passed' | 'failed') {
    await markUploaded(a.executionId);
    clock.set('2026-11-02T05:00:00Z');
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id], result === 'failed' ? [a.w.c.temp.id] : []);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, { result })).status).toBe(200);
    return auditId;
  }

  it('tells the executor of a send-back by push and inbox, with the count and the due date, opening the run', async () => {
    const a = await auditWorld(t, clock);
    // Earlier events (checklist.assigned, …) fan out before the device exists, so only the new push is counted.
    await fanOutAll(t, a.w.s.tenantId);
    const device = await addDevice(a.w.s.tenantId, a.worker.id);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, {
      items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }, { itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }],
      dueAt: '2026-11-03T06:00:00.000Z',
    });
    await fanOutAll(t, a.w.s.tenantId);
    expect(await only(a.worker.id, 'run.correction_required')).toEqual([
      expect.objectContaining({
        title: 'Düzəliş tələb olunur',
        body: 'İcra yoxlaması — Filial 1: 2 bənd düzəliş gözləyir. Son tarix: 03.11.2026 10:00.',
        target_kind: 'occurrence',
        target_id: a.w.occurrenceId,
        target_date: '2026-11-02',
      }),
    ]);
    expect((await deliveriesOf(a.worker.id)).map((d) => [d.channel, d.device_id])).toEqual([['push', device.id]]);
    expect(await only(a.manager.id, 'run.correction_required')).toEqual([]);
    expect(await only(a.w.workers[1].id, 'run.correction_required')).toEqual([]);
  });

  it('tells whoever sent the run back of the resubmit, in the inbox only', async () => {
    const a = await auditWorld(t, clock);
    await fanOutAll(t, a.w.s.tenantId);
    await addDevice(a.w.s.tenantId, a.manager.id);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set(LATER);
    await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, { ...a.answers, [a.w.c.temp.id]: { number: 5 } }, LATER));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).status).toBe(200);
    await fanOutAll(t, a.w.s.tenantId);
    expect(await only(a.manager.id, 'run.resubmitted')).toEqual([
      expect.objectContaining({ title: 'Düzəliş təqdim edildi', body: 'İcra yoxlaması — Filial 1: İşçi 1 düzəlişləri təqdim etdi (raund 1).', target_id: a.w.occurrenceId }),
    ]);
    expect(await deliveriesOf(a.manager.id)).toEqual([]);
    expect(await only(a.worker.id, 'run.resubmitted')).toEqual([]);
  });

  it('tells the executor and the managers in scope of a failed audit', async () => {
    const a = await auditWorld(t, clock);
    await finishAudit(a, 'failed');
    await fanOutAll(t, a.w.s.tenantId);
    const expected = expect.objectContaining({ title: 'Audit tamamlandı', body: 'İcra yoxlaması — Filial 1: Uğursuz, audit balı 75%.', target_kind: 'occurrence', target_date: '2026-11-02' });
    expect(await only(a.worker.id, 'audit.finished')).toEqual([expected]);
    expect(await only(a.manager.id, 'audit.finished')).toEqual([expected]);
    expect(await only(a.outsider.id, 'audit.finished')).toEqual([]);
    expect(await only(a.auditor.id, 'audit.finished')).toEqual([]);
  });

  it('under the default failed-only filter, tells the executor of a passed audit but not the managers (R11)', async () => {
    const a = await auditWorld(t, clock);
    await finishAudit(a, 'passed');
    await fanOutAll(t, a.w.s.tenantId);
    expect((await eventRows(a.w.s.tenantId, 'audit.finished')).map((e) => e.outcome)).toEqual(['fanned_out']);
    expect((await only(a.worker.id, 'audit.finished')).map((n) => n.body)).toEqual(['İcra yoxlaması — Filial 1: Uğurlu, audit balı 100%.']);
    expect(await only(a.manager.id, 'audit.finished')).toEqual([]);
  });

  it('notifies the managers of a passed audit once the filter is any, and the executor either way', async () => {
    const a = await auditWorld(t, clock);
    const rules = (await a.w.owner.get('/api/v1/notification-rules')).body as { type: string; roleIds: string[] }[];
    const roleIds = rules.find((r) => r.type === 'audit.finished')!.roleIds;
    expect(roleIds.length).toBeGreaterThan(0);
    const rule = { enabled: true, push: false, email: false, notifyAssignees: true, notifyCreator: false, roleIds, leadMinutes: null, resultFilter: 'any' };
    const saved = await a.w.owner.put('/api/v1/notification-rules/audit.finished', rule);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ type: 'audit.finished', resultFilter: 'any', isDefault: false });
    await finishAudit(a, 'passed');
    await fanOutAll(t, a.w.s.tenantId);
    const body = 'İcra yoxlaması — Filial 1: Uğurlu, audit balı 100%.';
    expect((await only(a.worker.id, 'audit.finished')).map((n) => n.body)).toEqual([body]);
    expect((await only(a.manager.id, 'audit.finished')).map((n) => n.body)).toEqual([body]);
  });

  it('tells the executor of a failed audit under a failed filter that has no roles', async () => {
    const a = await auditWorld(t, clock);
    const rule = { enabled: true, push: false, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, resultFilter: 'failed' };
    expect((await a.w.owner.put('/api/v1/notification-rules/audit.finished', rule)).status).toBe(200);
    await finishAudit(a, 'failed');
    await fanOutAll(t, a.w.s.tenantId);
    expect((await only(a.worker.id, 'audit.finished')).map((n) => n.body)).toEqual(['İcra yoxlaması — Filial 1: Uğursuz, audit balı 75%.']);
    expect(await only(a.manager.id, 'audit.finished')).toEqual([]);
  });

  it('keeps the result filter to audit.finished in the rules API', async () => {
    const a = await auditWorld(t, clock);
    const rules = (await a.w.owner.get('/api/v1/notification-rules')).body as { type: string; resultFilter: string | null }[];
    expect(rules.filter((r) => r.resultFilter !== null).map((r) => [r.type, r.resultFilter])).toEqual([['audit.finished', 'failed']]);
    const base = { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null };
    const bad = await a.w.owner.put('/api/v1/notification-rules/checklist.overdue', { ...base, resultFilter: 'any' });
    expect([bad.status, bad.body.error.fields]).toEqual([400, { resultFilter: 'notifications.issues.resultFilterNotApplicable' }]);
    // An old client without the field keeps the default filter.
    expect((await a.w.owner.put('/api/v1/notification-rules/audit.finished', { ...base, push: false })).body.resultFilter).toBe('failed');
  });
});

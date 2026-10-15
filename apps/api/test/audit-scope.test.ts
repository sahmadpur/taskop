import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correctionRows, markUploaded, reworkRows, resubmit, startAudit } from './audit-fixtures';
import { answersBody } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { eventRows, fanOutAll, inboxOf } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const LATER = '2026-11-02T12:00:00.000Z';

describe('audit and correction scope, permissions and platform admins (spec §5, §10)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let platform: Api;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    const email = `${uniq('admin')}@taskop.az`;
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    platform = as(t, (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock);
    clock.set(AT);
    return a;
  };
  /** A staff user of a custom role with `permissions`, limited to `siteIds` (site_subtree) or the whole tenant. */
  const custom = async (a: AuditWorld, permissions: string[], siteIds: string[] | null): Promise<Api> => {
    const role = await a.w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope: siteIds ? 'site_subtree' : 'all', permissions });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const u = await createUserDirect(t, a.w.s.tenantId, { kind: 'staff', roleId: role.body.id, emailVerified: true });
    if (siteIds) expect((await a.w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds })).status).toBe(200);
    return as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
  };
  /** Status codes of every new endpoint for one caller, against one run and its audit. */
  const statuses = async (api: Api, a: AuditWorld, auditId: string) => {
    const x = a.executionId;
    return {
      correct: (await api.post(`/api/v1/executions/${x}/corrections`, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'x' } }], reason: 'x' })).status,
      sendBack: (await api.post(`/api/v1/executions/${x}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }], dueAt: '2026-01-01T00:00:00.000Z' })).status,
      withdraw: (await api.post(`/api/v1/executions/${x}/send-back/cancel`)).status,
      history: (await api.get(`/api/v1/executions/${x}/corrections`)).status,
      start: (await api.post(`/api/v1/executions/${x}/audits`)).status,
      list: (await api.get('/api/v1/audits?queue=in_progress')).status,
      get: (await api.get(`/api/v1/audits/${auditId}`)).status,
      verdict: (await api.put(`/api/v1/audits/${auditId}/items/${a.w.c.photo.id}`, { verdict: 'approved' })).status,
      clear: (await api.delete(`/api/v1/audits/${auditId}/items/${a.w.c.note.id}`)).status,
      finish: (await api.post(`/api/v1/audits/${auditId}/finish`, { result: 'passed', extraEmails: ['not-an-address'] })).status,
      cancel: (await api.post(`/api/v1/audits/${auditId}/cancel`, { reason: '' })).status,
      pdf: (await api.get(`/api/v1/audits/${auditId}/report.pdf`)).status,
      send: (await api.post(`/api/v1/audits/${auditId}/report/send`, { emails: [] })).status,
    };
  };

  it('gives each built-in role exactly its keys, inside its scope', async () => {
    const a = await world();
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    // Bodies are invalid or the state refuses the change, so nothing is written: 400 / 409 mean "allowed in".
    expect(await statuses(a.worker.api, a, auditId)).toEqual({
      correct: 403, sendBack: 403, withdraw: 403, history: 200, start: 403, list: 403, get: 403, verdict: 403, clear: 403, finish: 403, cancel: 403, pdf: 403, send: 403,
    });
    expect(await statuses(a.manager.api, a, auditId)).toEqual({
      correct: 200, sendBack: 400, withdraw: 409, history: 200, start: 403, list: 403, get: 200, verdict: 403, clear: 403, finish: 403, cancel: 403, pdf: 409, send: 403,
    });
    expect(await statuses(a.auditor.api, a, auditId)).toEqual({
      correct: 403, sendBack: 403, withdraw: 403, history: 200, start: 409, list: 200, get: 200, verdict: 200, clear: 204, finish: 400, cancel: 400, pdf: 409, send: 400,
    });
  });

  it('answers 404 on every new endpoint to callers whose scope does not cover the run', async () => {
    const a = await world();
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    const everything = await custom(a, ['executions.correct', 'audits.perform', 'reports.view'], [a.w.otherSiteId]);
    const s = await statuses(everything, a, auditId);
    // Schema validation (finish, cancel, send) runs before the scope check, so those invalid bodies answer 400 first;
    // send-back's past due date is checked inside the service, after the scope.
    expect(s).toEqual({
      correct: 404, sendBack: 404, withdraw: 404, history: 404, start: 404, list: 200, get: 404, verdict: 404, clear: 404, finish: 400, cancel: 400, pdf: 404, send: 400,
    });
    expect((await everything.post(`/api/v1/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }] })).status).toBe(404);
    expect((await everything.post(`/api/v1/audits/${auditId}/finish`, { result: 'passed' })).status).toBe(404);
    expect((await everything.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await everything.post(`/api/v1/audits/${auditId}/report/send`, {})).status).toBe(404);
    expect((await everything.get('/api/v1/audits?queue=in_progress')).body.items).toEqual([]);
    expect((await a.outsider.api.get(`/api/v1/audits/${auditId}`)).status).toBe(404);
  });

  /** Every write route with a body that is valid for the run, as one caller; nothing is written unless the caller may. */
  const writes = async (api: Api, a: AuditWorld, auditId: string) => ({
    correct: (await api.post(`/api/v1/executions/${a.executionId}/corrections`, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'x' } }], reason: 'x' })).status,
    sendBack: (await api.post(`/api/v1/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }] })).status,
    withdraw: (await api.post(`/api/v1/executions/${a.executionId}/send-back/cancel`)).status,
    start: (await api.post(`/api/v1/executions/${a.executionId}/audits`)).status,
    verdict: (await api.put(`/api/v1/audits/${auditId}/items/${a.w.c.photo.id}`, { verdict: 'approved' })).status,
    clear: (await api.delete(`/api/v1/audits/${auditId}/items/${a.w.c.note.id}`)).status,
    cancel: (await api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' })).status,
    finish: (await api.post(`/api/v1/audits/${auditId}/finish`, { result: 'passed' })).status,
    send: (await api.post(`/api/v1/audits/${auditId}/report/send`, { emails: ['a@b.az'] })).status,
  });
  const unchanged = async (a: AuditWorld, auditId: string) => {
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect(await reworkRows(a.executionId)).toEqual([]);
    const audits = await ownerQuery<{ status: string }>('select status from audits where id = $1', [auditId]);
    expect(audits.rows).toEqual([{ status: 'in_progress' }]);
    expect((await ownerQuery('select 1 from audit_item_verdicts where audit_id = $1', [auditId])).rowCount).toBe(0);
  };

  it('answers 404 to every write with a valid body when the run is outside the caller scope, and writes nothing', async () => {
    const a = await world();
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    const elsewhere = await custom(a, ['executions.correct', 'audits.perform', 'reports.view'], [a.w.otherSiteId]);
    const all404 = { correct: 404, sendBack: 404, withdraw: 404, start: 404, verdict: 404, clear: 404, cancel: 404, finish: 404, send: 404 };
    expect(await writes(elsewhere, a, auditId)).toEqual(all404);
    // The built-in Manager of the other site holds executions.correct and reports.view; the run is still not theirs.
    expect(await writes(a.outsider.api, a, auditId)).toEqual({ ...all404, start: 403, verdict: 403, clear: 403, cancel: 403, finish: 403, send: 403 });
    await unchanged(a, auditId);
  });

  it('answers 403 to every write with a valid body for a worker and for a role without the key, and writes nothing', async () => {
    const a = await world();
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    const none = { correct: 403, sendBack: 403, withdraw: 403, start: 403, verdict: 403, clear: 403, cancel: 403, finish: 403, send: 403 };
    expect(await writes(a.worker.api, a, auditId)).toEqual(none);
    const reader = await custom(a, ['reports.view'], null);
    expect(await writes(reader, a, auditId)).toEqual(none);
    // Each key opens only its own group: audits.perform alone cannot correct or send back; executions.correct alone cannot audit.
    const auditOnly = await custom(a, ['audits.perform'], null);
    expect(await writes(auditOnly, a, auditId)).toMatchObject({ correct: 403, sendBack: 403, withdraw: 403 });
    const correctOnly = await custom(a, ['executions.correct'], null);
    expect(await writes(correctOnly, a, auditId)).toMatchObject({ start: 403, verdict: 403, clear: 403, cancel: 403, finish: 403, send: 403 });
    // Reading an audit outcome needs audits.perform or reports.view; the correction history does not need either.
    expect((await correctOnly.get(`/api/v1/audits/${auditId}`)).status).toBe(403);
    expect((await reader.get(`/api/v1/audits/${auditId}`)).status).toBe(200);
    expect((await reader.get('/api/v1/audits?queue=in_progress')).status).toBe(403);
  });

  const outcomeOf = (occurrenceId: string) =>
    ownerQuery<{ from_status: string | null; to_status: string; actor_user_id: string | null; actor_platform_admin_id: string | null }>(
      'select from_status, to_status, actor_user_id, actor_platform_admin_id from occurrence_status_history where occurrence_id = $1 order by at, id',
      [occurrenceId],
    ).then((r) => r.rows);

  it('lets platform admins correct, send back and audit inside the tenant, attributed to them', async () => {
    const a = await world();
    const base = `/api/v1/platform/tenants/${a.w.s.tenantId}`;
    const fix = await platform.post(`${base}/executions/${a.executionId}/corrections`, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'Taskop dəstəyi' } }], reason: 'Müştərinin xahişi' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(await correctionRows(a.executionId)).toEqual([expect.objectContaining({ actor_user_id: null, actor_platform_admin_id: expect.any(String) })]);
    expect((await auditLogOf(a.executionId)).at(-1)).toMatchObject({ action: 'execution.corrected', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
    const started = await platform.post(`${base}/executions/${a.executionId}/audits`);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body.auditor).toEqual({ kind: 'platform', id: null, name: null });
    expect((await platform.get(`${base}/audits/${started.body.id}`)).status).toBe(200);
    await markUploaded(a.executionId);
    const back = await platform.post(`${base}/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.requestedBy).toBeNull();
    expect((await platform.post(`${base}/executions/${a.executionId}/send-back/cancel`)).body.withdrawnBy).toBeNull();
    // A platform admin of another tenant's id sees nothing.
    const other = await auditWorld(t, clock);
    expect((await platform.post(`/api/v1/platform/tenants/${other.w.s.tenantId}/executions/${a.executionId}/corrections`, { answersRev: 2, changes: [{ itemId: a.w.c.note.id, answer: null }], reason: 'x' })).status).toBe(404);
  });

  it('attributes a platform admin send-back and withdrawal in the rework row, the status history and the audit log', async () => {
    const a = await world();
    const base = `/api/v1/platform/tenants/${a.w.s.tenantId}`;
    await markUploaded(a.executionId);
    expect((await platform.post(`${base}/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] })).status).toBe(200);
    expect(await reworkRows(a.executionId)).toEqual([expect.objectContaining({ requested_by_user_id: null, withdrawn_at: null })]);
    expect((await outcomeOf(a.w.occurrenceId)).at(-1)).toMatchObject({ from_status: 'completed', to_status: 'correction_required', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
    expect((await platform.post(`${base}/executions/${a.executionId}/send-back/cancel`)).status).toBe(200);
    expect(await reworkRows(a.executionId)).toEqual([expect.objectContaining({ withdrawn_by_user_id: null, withdrawn_at: expect.any(Date) })]);
    expect((await outcomeOf(a.w.occurrenceId)).at(-1)).toMatchObject({ from_status: 'correction_required', to_status: 'completed', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
    const log = await auditLogOf(a.executionId);
    expect(log.filter((r) => r.action === 'execution.sent_back' || r.action === 'execution.send_back_withdrawn')).toEqual([
      expect.objectContaining({ action: 'execution.sent_back', actor_user_id: null, actor_platform_admin_id: expect.any(String) }),
      expect.objectContaining({ action: 'execution.send_back_withdrawn', actor_user_id: null, actor_platform_admin_id: expect.any(String) }),
    ]);
  });

  it('records no resubmit notification for the creator when a platform admin sent the run back', async () => {
    const a = await world();
    const base = `/api/v1/platform/tenants/${a.w.s.tenantId}`;
    await fanOutAll(t, a.w.s.tenantId);
    await markUploaded(a.executionId);
    expect((await platform.post(`${base}/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] })).status).toBe(200);
    clock.set(LATER);
    expect((await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, { ...a.answers, [a.w.c.temp.id]: { number: 5 } }, LATER))).status).toBe(200);
    expect((await resubmit(a.worker.api, a.executionId, LATER)).status).toBe(200);
    expect((await auditLogOf(a.executionId)).at(-1)).toMatchObject({ action: 'execution.resubmitted', actor_user_id: a.worker.id, actor_platform_admin_id: null });
    await fanOutAll(t, a.w.s.tenantId);
    // The event is raised for the executor's resubmit and processed, but nobody is "the creator", so it has no recipients.
    expect((await eventRows(a.w.s.tenantId, 'run.resubmitted')).map((e) => e.outcome)).toEqual(['no_recipients']);
    for (const id of [a.manager.id, a.outsider.id, a.auditor.id, a.worker.id]) {
      expect((await inboxOf(id)).filter((n) => n.type === 'run.resubmitted')).toEqual([]);
    }
    expect((await ownerQuery("select 1 from notifications where tenant_id = $1 and type = 'run.resubmitted'", [a.w.s.tenantId])).rowCount).toBe(0);
  });

  it('lets platform admins run an audit from the queue to the verdicts, the finish and a cancellation, attributed to them', async () => {
    const a = await world();
    const base = `/api/v1/platform/tenants/${a.w.s.tenantId}`;
    await markUploaded(a.executionId);
    const started = await platform.post(`${base}/executions/${a.executionId}/audits`);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const auditId = started.body.id as string;
    expect(await outcomeOf(a.w.occurrenceId)).toContainEqual(expect.objectContaining({ from_status: 'completed', to_status: 'audit_pending', actor_user_id: null, actor_platform_admin_id: expect.any(String) }));
    expect((await auditLogOf(auditId))[0]).toMatchObject({ action: 'audit.started', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
    const queue = await platform.get(`${base}/audits?queue=in_progress`);
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(queue.body.items.map((r: { auditId: string }) => r.auditId)).toContain(auditId);
    // Another tenant's id lists none of it and cannot read it.
    const other = await auditWorld(t, clock);
    expect((await platform.get(`/api/v1/platform/tenants/${other.w.s.tenantId}/audits?queue=in_progress`)).body.items.map((r: { auditId: string }) => r.auditId)).not.toContain(auditId);
    expect((await platform.get(`/api/v1/platform/tenants/${other.w.s.tenantId}/audits/${auditId}`)).status).toBe(404);
    const items = [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id];
    for (const itemId of items) {
      const v = await platform.put(`${base}/audits/${auditId}/items/${itemId}`, { verdict: 'approved' });
      expect(v.status, JSON.stringify(v.body)).toBe(200);
      expect(v.body.updatedBy).toBeNull();
    }
    const read = (await platform.get(`${base}/audits/${auditId}`)).body.verdicts as { itemId: string; updatedBy: unknown }[];
    expect(read.map((v) => v.itemId).sort()).toEqual([...items].sort());
    expect(read.every((v) => v.updatedBy === null)).toBe(true);
    expect((await platform.delete(`${base}/audits/${auditId}/items/${a.w.c.note.id}`)).status).toBe(204);
    expect((await platform.put(`${base}/audits/${auditId}/items/${a.w.c.note.id}`, { verdict: 'approved' })).status).toBe(200);
    const done = await platform.post(`${base}/audits/${auditId}/finish`, { result: 'passed' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.auditor).toEqual({ kind: 'platform', id: null, name: null });
    expect(await outcomeOf(a.w.occurrenceId)).toContainEqual(expect.objectContaining({ from_status: 'audit_pending', to_status: 'audited', actor_user_id: null, actor_platform_admin_id: expect.any(String) }));
    expect((await auditLogOf(auditId)).find((r) => r.action === 'audit.finished')).toMatchObject({ actor_user_id: null, actor_platform_admin_id: expect.any(String) });

    // A second run: started and cancelled by a platform admin.
    const b = await world();
    const baseB = `/api/v1/platform/tenants/${b.w.s.tenantId}`;
    const startedB = await platform.post(`${baseB}/executions/${b.executionId}/audits`);
    expect(startedB.status, JSON.stringify(startedB.body)).toBe(201);
    const cancelled = await platform.post(`${baseB}/audits/${startedB.body.id}/cancel`, { reason: 'Səhv başladıldı' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.auditor).toEqual({ kind: 'platform', id: null, name: null });
    expect((await outcomeOf(b.w.occurrenceId)).at(-1)).toMatchObject({ from_status: 'audit_pending', to_status: 'completed', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
    expect((await auditLogOf(startedB.body.id)).at(-1)).toMatchObject({ action: 'audit.cancelled', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
  });
});

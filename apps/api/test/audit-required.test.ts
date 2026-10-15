import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { auditLogOf, auditWorld } from './audit-fixtures';
import { claimOk, completeExecution, executionWorld, fullAnswers, historyOf, registerPhoto, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, uniq } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

const DONE = '2026-11-02T04:20:00.000Z';

describe('audit settings and the audit queue on completion (spec §3.1, §4.1)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('stores the audit settings on the checklist, lower-cased and de-duplicated, as a checklist.updated entry', async () => {
    const w = await executionWorld(t);
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    const res = await manager.api.patch(`/api/v1/checklists/${w.checklistId}`, { requiresAudit: true, auditReportEmails: ['QA@Acme.az', 'qa@acme.az', 'boss@acme.az'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ requiresAudit: true, auditReportEmails: ['qa@acme.az', 'boss@acme.az'] });
    expect((await w.owner.get(`/api/v1/checklists/${w.checklistId}`)).body).toMatchObject({ requiresAudit: true, auditReportEmails: ['qa@acme.az', 'boss@acme.az'] });
    expect((await auditLogOf(w.checklistId)).at(-1)).toMatchObject({
      action: 'checklist.updated',
      before: { requiresAudit: false, auditReportEmails: [] },
      after: { requiresAudit: true, auditReportEmails: ['qa@acme.az', 'boss@acme.az'] },
    });
    // A name-only change keeps the settings.
    expect((await manager.api.patch(`/api/v1/checklists/${w.checklistId}`, { name: 'Yeni ad' })).body).toMatchObject({ name: 'Yeni ad', requiresAudit: true });
  });

  it('reads and writes the settings on the platform in-tenant route too', async () => {
    const w = await executionWorld(t);
    const email = `${uniq('admin')}@taskop.az`;
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    const platform = as(t, (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken);
    const base = `/api/v1/platform/tenants/${w.s.tenantId}/checklists/${w.checklistId}`;
    const res = await platform.patch(base, { requiresAudit: true, auditReportEmails: ['qa@acme.az'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await platform.get(base)).body).toMatchObject({ requiresAudit: true, auditReportEmails: ['qa@acme.az'] });
    expect((await auditLogOf(w.checklistId)).at(-1)).toMatchObject({ action: 'checklist.updated', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
  });

  it('refuses more than ten addresses and invalid ones', async () => {
    const w = await executionWorld(t);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@acme.az`);
    const many = await w.owner.patch(`/api/v1/checklists/${w.checklistId}`, { auditReportEmails: eleven });
    expect([many.status, many.body.error.fields]).toEqual([400, { auditReportEmails: 'audits.issues.tooManyEmails' }]);
    const bad = await w.owner.patch(`/api/v1/checklists/${w.checklistId}`, { auditReportEmails: ['not-an-address'] });
    expect([bad.status, bad.body.error.fields]).toEqual([400, { 'auditReportEmails.0': 'errors.validation.email' }]);
    expect((await w.workers[0].api.patch(`/api/v1/checklists/${w.checklistId}`, { requiresAudit: true })).status).toBe(403);
  });

  it('moves a completed run to audit_pending in the same transaction, the second step by the system', async () => {
    const a = await auditWorld(t, clock, { requiresAudit: true });
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
    expect((await historyOf(a.w.occurrenceId)).slice(-2)).toEqual([
      ['started', 'completed', DONE, null, a.worker.id],
      ['completed', 'audit_pending', DONE, null, null],
    ]);
    const occurrence = (await a.manager.api.get(`/api/v1/occurrences/${a.w.occurrenceId}`)).body;
    expect(occurrence.execution.state).toBe('completed');
  });

  it('leaves runs of a checklist without the flag completed', async () => {
    const a = await auditWorld(t, clock);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
  });

  it('never sends a partial run to audit', async () => {
    const w = await executionWorld(t);
    await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:01:00Z');
    expect((await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T07:00:00.000Z')).body.state).toBe('partial');
    expect(await statusOf(w.occurrenceId)).toBe('partial');
  });

  it('sends a swept partial run revived by a late completion to audit as well', async () => {
    const w = await executionWorld(t);
    await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    clock.set('2026-11-02T07:30:00Z');
    expect((await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T06:50:00.000Z')).body.state).toBe('completed');
    expect((await historyOf(w.occurrenceId)).slice(-2).map((h) => [h[0], h[1], h[3], h[4]])).toEqual([
      ['partial', 'completed', 'late_sync', w.workers[0].id],
      ['completed', 'audit_pending', null, null],
    ]);
  });
});

import { RULE_TYPES } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, roleIdOf, signupTenant } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';

const full = { enabled: true, push: false, email: true, notifyAssignees: true, notifyCreator: true, roleIds: [] as string[], leadMinutes: null };

describe('notification rules API', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lists every rule type with its effective defaults', async () => {
    const s = await signupTenant(t);
    const res = await as(t, s.accessToken).get('/api/v1/notification-rules');
    expect(res.status).toBe(200);
    expect(res.body.map((r: { type: string }) => r.type)).toEqual([...RULE_TYPES]);
    const manager = await roleIdOf(s.tenantId, 'manager');
    const admin = await roleIdOf(s.tenantId, 'admin');
    expect(res.body.find((r: { type: string }) => r.type === 'problem.critical')).toEqual({
      type: 'problem.critical', enabled: true, push: true, email: true, notifyAssignees: false, notifyCreator: false, roleIds: [manager, admin], leadMinutes: null, isDefault: true,
    });
  });

  it('saves an override, audits it, and resets back to the default', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const manager = await roleIdOf(s.tenantId, 'manager');
    const saved = await owner.put('/api/v1/notification-rules/task.overdue', { ...full, roleIds: [manager, manager] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ type: 'task.overdue', ...full, roleIds: [manager], isDefault: false });
    expect((await owner.get('/api/v1/notification-rules')).body.find((r: { type: string }) => r.type === 'task.overdue').isDefault).toBe(false);
    const reset = await owner.delete('/api/v1/notification-rules/task.overdue');
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ type: 'task.overdue', push: true, email: false, isDefault: true });
    expect((await owner.delete('/api/v1/notification-rules/task.overdue')).status).toBe(200);
    const audit = await ownerQuery<{ action: string; entity_type: string; entity_id: string | null; after: { type: string; isDefault: boolean } }>(
      "select action, entity_type, entity_id, after from audit_log where tenant_id = $1 and entity_type = 'notification_rule' order by occurred_at, id",
      [s.tenantId],
    );
    expect(audit.rows.map((r) => [r.action, r.entity_type, r.entity_id, r.after.type, r.after.isDefault])).toEqual([
      ['notification_rule.updated', 'notification_rule', null, 'task.overdue', false],
      ['notification_rule.reset', 'notification_rule', null, 'task.overdue', true],
    ]);
  });

  it('checks the lead time, the audiences and the roles', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const bad = async (type: string, body: object) => (await owner.put(`/api/v1/notification-rules/${type}`, body)).body.error;
    expect(await bad('checklist.due_soon', { ...full, notifyCreator: false })).toMatchObject({
      code: 'VALIDATION_FAILED', fields: { leadMinutes: 'notifications.issues.leadMinutesRequired' },
    });
    expect(await bad('problem.recorded', { ...full, leadMinutes: 30 })).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { leadMinutes: 'notifications.issues.leadMinutesNotApplicable', notifyAssignees: 'notifications.issues.audienceNotApplicable', notifyCreator: 'notifications.issues.audienceNotApplicable' },
    });
    expect(await bad('task.assigned', { ...full, leadMinutes: 45 })).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await bad('task.assigned', { ...full, roleIds: [uuidv7()] })).toMatchObject({ code: 'REFERENCE_NOT_FOUND', fields: { roleIds: 'errors.REFERENCE_NOT_FOUND' } });
    const other = await signupTenant(t);
    expect(await bad('task.assigned', { ...full, roleIds: [await roleIdOf(other.tenantId, 'manager')] })).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
    expect((await owner.put('/api/v1/notification-rules/manual', full)).status).toBe(404);
    expect((await owner.get('/api/v1/notification-rules/nope')).status).toBe(404);
    const ok = await owner.put('/api/v1/notification-rules/checklist.due_soon', { ...full, notifyCreator: false, leadMinutes: 120 });
    expect(ok.body).toMatchObject({ leadMinutes: 120, isDefault: false });
  });

  it('drops role ids that have no role row any more', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const manager = await roleIdOf(s.tenantId, 'manager');
    expect((await owner.put('/api/v1/notification-rules/task.completed', { ...full, notifyAssignees: false, roleIds: [manager] })).status).toBe(200);
    await ownerQuery("update notification_rules set role_ids = role_ids || $2::uuid where tenant_id = $1 and type = 'task.completed'", [s.tenantId, uuidv7()]);
    expect((await owner.get('/api/v1/notification-rules')).body.find((r: { type: string }) => r.type === 'task.completed').roleIds).toEqual([manager]);
  });

  it('needs notifications.manage', async () => {
    const s = await signupTenant(t);
    const manager = await staffAt(t, s.tenantId, as(t, s.accessToken), 'manager', []);
    expect((await manager.api.get('/api/v1/notification-rules')).status).toBe(403);
    expect((await manager.api.put('/api/v1/notification-rules/task.assigned', full)).status).toBe(403);
    expect((await manager.api.delete('/api/v1/notification-rules/task.assigned')).status).toBe(403);
    const admin = await staffAt(t, s.tenantId, as(t, s.accessToken), 'admin', []);
    expect((await admin.api.get('/api/v1/notification-rules')).status).toBe(200);
  });
});

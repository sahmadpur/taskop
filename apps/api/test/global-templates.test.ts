import { hash } from '@node-rs/argon2';
import { blankContent } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, signupTenant, uniq } from './fixtures';
import { ownerQuery } from './owner-db';

describe('platform checklist authoring', () => {
  let t: TestApp;
  let token: string;
  let adminId: string;
  beforeAll(async () => {
    t = await createTestApp();
    const email = `${uniq('admin')}@taskop.az`;
    const r = await ownerQuery<{ id: string }>(
      "insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support') returning id",
      [email, await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 })],
    );
    adminId = r.rows[0]!.id;
    token = (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken;
  });
  afterAll(() => t.close());

  it('authors a global template and controls tenant visibility by publishing', async () => {
    const p = as(t, token);
    const created = await p.post('/api/v1/platform/templates', { name: 'Anbar qəbulu', category: 'warehouse' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ published: false, revision: 1 });
    const id = created.body.id;
    expect((await p.post(`/api/v1/platform/templates/${id}/publish`)).body.error.code).toBe('CHECKLIST_INVALID_CONTENT');
    expect((await p.put(`/api/v1/platform/templates/${id}/content`, { content: sampleContent(), revision: 1 })).body).toEqual({ revision: 2, issues: [] });
    expect((await p.put(`/api/v1/platform/templates/${id}/content`, { content: blankContent(), revision: 1 })).body.error.code).toBe('TEMPLATE_CONFLICT');
    const s = await signupTenant(t);
    const tenant = as(t, s.accessToken);
    expect((await tenant.get(`/api/v1/templates/global/${id}`)).status).toBe(404);
    expect((await p.post(`/api/v1/platform/templates/${id}/publish`)).body.published).toBe(true);
    expect((await tenant.get(`/api/v1/templates/global/${id}`)).body.itemCount).toBe(2);
    expect((await p.patch(`/api/v1/platform/templates/${id}`, { sortOrder: 5, name: 'Anbar qəbulu (yeni)' })).body).toMatchObject({ sortOrder: 5, name: 'Anbar qəbulu (yeni)' });
    await p.post(`/api/v1/platform/templates/${id}/unpublish`);
    expect((await tenant.get(`/api/v1/templates/global/${id}`)).status).toBe(404);
    const audit = await ownerQuery<{ action: string; tenant_id: string | null; actor_platform_admin_id: string }>(
      'select action, tenant_id, actor_platform_admin_id from audit_log where entity_id = $1 order by occurred_at, id',
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'global_template.created', 'global_template.updated', 'global_template.published', 'global_template.updated', 'global_template.unpublished',
    ]);
    expect(audit.rows.every((r) => r.tenant_id === null && r.actor_platform_admin_id === adminId)).toBe(true);
  });

  it('builds and publishes a checklist inside a tenant with platform attribution', async () => {
    const s = await signupTenant(t);
    const other = await signupTenant(t);
    const p = as(t, token);
    const base = `/api/v1/platform/tenants/${s.tenantId}/checklists`;
    const c = await p.post(base, { name: 'Taskop tərəfindən' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await p.put(`${base}/${c.body.id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await p.post(`${base}/${c.body.id}/publish`, { revision: 2 })).body;
    expect(v1.publishedBy).toEqual({ kind: 'platform', name: null });
    const row = await ownerQuery('select created_by_user_id, created_by_platform_admin_id from checklists where id = $1', [c.body.id]);
    expect(row.rows[0]).toEqual({ created_by_user_id: null, created_by_platform_admin_id: adminId });
    const audit = await ownerQuery<{ tenant_id: string; actor_platform_admin_id: string; actor_user_id: string | null }>(
      "select tenant_id, actor_platform_admin_id, actor_user_id from audit_log where entity_id = $1 and action = 'checklist.published'",
      [c.body.id],
    );
    expect(audit.rows[0]).toEqual({ tenant_id: s.tenantId, actor_platform_admin_id: adminId, actor_user_id: null });
    expect((await as(t, s.accessToken).get(`/api/v1/checklists/${c.body.id}`)).status).toBe(200);
    expect((await as(t, other.accessToken).get(`/api/v1/checklists/${c.body.id}`)).status).toBe(404);
    expect((await p.get(`/api/v1/platform/tenants/${other.tenantId}/checklists/${c.body.id}`)).status).toBe(404);
    const tpl = await p.post(`/api/v1/platform/tenants/${s.tenantId}/templates`, { name: 'Hazır', category: 'other' });
    expect(tpl.status).toBe(201);
  });

  it('rejects tenant tokens and unknown tenants on platform routes', async () => {
    const s = await signupTenant(t);
    expect((await as(t, s.accessToken).get('/api/v1/platform/templates')).status).toBe(401);
    expect((await as(t, s.accessToken).get(`/api/v1/platform/tenants/${s.tenantId}/checklists`)).status).toBe(401);
    expect((await as(t, token).get('/api/v1/platform/tenants/0190a4d2-7c3e-7000-8000-000000000999/checklists')).status).toBe(404);
    expect((await as(t, token).get('/api/v1/platform/tenants/not-a-uuid/checklists')).status).toBe(404);
  });
});

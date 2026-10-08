import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, signupTenant, uniq } from './fixtures';
import { ownerQuery } from './owner-db';

describe('platform admin', () => {
  let t: TestApp;
  let token: string;
  const email = `${uniq('admin')}@taskop.az`;

  beforeAll(async () => {
    t = await createTestApp();
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    const res = await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' });
    expect(res.status).toBe(200);
    token = res.body.accessToken;
  });
  afterAll(() => t.close());

  it('rejects wrong credentials', async () => {
    const res = await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'wrong' });
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('keeps platform and tenant tokens apart', async () => {
    const s = await signupTenant(t);
    expect((await as(t, s.accessToken).get('/api/v1/platform/tenants')).status).toBe(401);
    expect((await as(t, token).get('/api/v1/me')).status).toBe(401);
  });

  it('lists tenants with user counts and search', async () => {
    const s = await signupTenant(t);
    const res = await as(t, token).get(`/api/v1/platform/tenants?q=${s.orgCode}`);
    expect(res.body.items).toEqual([expect.objectContaining({ id: s.tenantId, orgCode: s.orgCode, status: 'active', userCount: 1 })]);
  });

  it('suspends and reactivates a tenant', async () => {
    const s = await signupTenant(t);
    const suspended = await as(t, token).post(`/api/v1/platform/tenants/${s.tenantId}/suspend`);
    expect(suspended.body.status).toBe('suspended');
    expect((await as(t, s.accessToken).get('/api/v1/me')).body.error.code).toBe('TENANT_SUSPENDED');
    const audit = await ownerQuery("select actor_platform_admin_id from audit_log where tenant_id = $1 and action = 'tenant.suspended'", [s.tenantId]);
    expect(audit.rows[0]?.actor_platform_admin_id).toBeTruthy();
    await as(t, token).post(`/api/v1/platform/tenants/${s.tenantId}/reactivate`);
    const login = await t.http().post('/api/v1/auth/login/staff').send({ email: s.email, password: s.password, client: 'web' });
    expect(login.status).toBe(200);
  });
});

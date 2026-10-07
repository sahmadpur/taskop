import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { bearer, createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('authentication guard and /me', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('rejects missing and invalid tokens', async () => {
    expect((await t.http().get('/api/v1/me')).body.error.code).toBe('UNAUTHENTICATED');
    expect((await t.http().get('/api/v1/me').set(bearer('garbage'))).status).toBe(401);
  });

  it('returns the current profile', async () => {
    const s = await signupTenant(t);
    const res = await t.http().get('/api/v1/me').set(bearer(s.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(s.me);
  });

  it('blocks a deactivated user immediately, even with a valid access token', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w.id]);
    expect((await t.http().get('/api/v1/me').set(bearer(login.accessToken))).status).toBe(401);
  });

  it('blocks a suspended tenant', async () => {
    const s = await signupTenant(t);
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [s.tenantId]);
    const res = await t.http().get('/api/v1/me').set(bearer(s.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_SUSPENDED');
  });

  it('reflects role permission changes on the next request', async () => {
    const s = await signupTenant(t);
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const login = await loginStaff(t, m.email!, m.secret);
    expect(login.me.permissions).toContain('users.view');
    await ownerQuery(
      "delete from role_permissions where permission_key = 'users.view' and role_id = (select id from roles where tenant_id = $1 and system_key = 'manager')",
      [s.tenantId],
    );
    await ownerQuery("update roles set version = version + 1 where tenant_id = $1 and system_key = 'manager'", [s.tenantId]);
    const me = await t.http().get('/api/v1/me').set(bearer(login.accessToken));
    expect(me.body.permissions).not.toContain('users.view');
  });
});

describe('logout and resend verification', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('logout revokes the session so refresh fails', async () => {
    const s = await signupTenant(t);
    const login = await loginStaff(t, s.email, s.password);
    expect((await t.http().post('/api/v1/auth/logout').set(bearer(login.accessToken))).status).toBe(204);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken })).status).toBe(401);
  });

  it('resends the verification email once per call (rate limited) and is a no-op when verified', async () => {
    const s = await signupTenant(t);
    const before = t.mailer.sent.length;
    expect((await t.http().post('/api/v1/auth/verify-email/resend').set(bearer(s.accessToken))).status).toBe(204);
    expect(t.mailer.sent.length).toBe(before + 1);
    await t.http().post('/api/v1/auth/verify-email').send({ token: t.mailer.tokenFor(s.email) });
    expect((await t.http().post('/api/v1/auth/verify-email/resend').set(bearer(s.accessToken))).status).toBe(204);
    expect(t.mailer.sent.length).toBe(before + 1);
  });
});

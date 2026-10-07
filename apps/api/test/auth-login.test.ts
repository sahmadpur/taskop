import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('login', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('logs staff in by email, ignoring case and whitespace', async () => {
    const s = await signupTenant(t);
    const r = await loginStaff(t, `  ${s.email.toUpperCase()} `, s.password);
    expect(r.me.user.id).toBe(s.ownerId);
  });

  it('logs workers in with org code + username + PIN, normalising both identifiers', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId, { username: 'elvin' });
    const r = await loginWorker(t, ` ${s.orgCode.toUpperCase()} `, 'Elvin', w.secret);
    expect(r.me.user).toMatchObject({ id: w.id, kind: 'worker', username: 'elvin' });
    expect(r.refreshToken).toBeTypeOf('string');
  });

  it('gives the same error for wrong secret, unknown user and deactivated user', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const d = await createUserDirect(t, s.tenantId, { status: 'deactivated' });
    const attempts = [
      { orgCode: s.orgCode, username: w.username, secret: '000001' },
      { orgCode: s.orgCode, username: 'nobody', secret: w.secret },
      { orgCode: s.orgCode, username: d.username, secret: d.secret },
      { orgCode: 'no-such-org', username: w.username, secret: w.secret },
    ];
    for (const a of attempts) {
      const res = await t.http().post('/api/v1/auth/login/worker').send({ ...a, client: 'mobile' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const failed = await ownerQuery("select after from audit_log where tenant_id = $1 and action = 'auth.login_failed'", [s.tenantId]);
    expect(failed.rows.map((r) => r.after.reason).sort()).toEqual(['bad_secret', 'inactive']);
  });

  it('locks the account for 15 minutes after 5 consecutive failures', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const attempt = (secret: string) =>
      t.http().post('/api/v1/auth/login/worker').send({ orgCode: s.orgCode, username: w.username, secret, client: 'mobile' });
    for (let i = 0; i < 4; i++) expect((await attempt('000001')).body.error.code).toBe('INVALID_CREDENTIALS');
    const fifth = await attempt('000001');
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.error.retryAfterSeconds).toBeGreaterThan(880);
    expect((await attempt(w.secret)).body.error.code).toBe('ACCOUNT_LOCKED');

    await ownerQuery("update users set locked_until = now() - interval '1 second' where id = $1", [w.id]);
    expect((await attempt(w.secret)).status).toBe(200);
    const row = await ownerQuery('select failed_login_count, locked_until from users where id = $1', [w.id]);
    expect(row.rows[0]).toMatchObject({ failed_login_count: 0, locked_until: null });
  });

  it('concurrent wrong secrets still lock the account', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const attempt = (secret: string) =>
      t.http().post('/api/v1/auth/login/worker').send({ orgCode: s.orgCode, username: w.username, secret, client: 'mobile' });
    await Promise.all(Array.from({ length: 6 }, () => attempt('000001')));
    const row = await ownerQuery('select failed_login_count, locked_until from users where id = $1', [w.id]);
    expect(row.rows[0]!.failed_login_count).toBeGreaterThanOrEqual(5);
    expect(row.rows[0]!.locked_until).not.toBeNull();
    expect((await attempt(w.secret)).body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('an expired lock restarts the count', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    await ownerQuery("update users set failed_login_count = 5, locked_until = now() - interval '1 second' where id = $1", [w.id]);
    const res = await t.http().post('/api/v1/auth/login/worker').send({ orgCode: s.orgCode, username: w.username, secret: '000001', client: 'mobile' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const row = await ownerQuery('select failed_login_count, locked_until from users where id = $1', [w.id]);
    expect(row.rows[0]).toMatchObject({ failed_login_count: 1, locked_until: null });
  });

  it('refuses login for a suspended tenant after correct credentials', async () => {
    const s = await signupTenant(t);
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [s.tenantId]);
    const res = await t.http().post('/api/v1/auth/login/staff').send({ email: s.email, password: s.password, client: 'web' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_SUSPENDED');
  });
});

describe('login rate limiting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RL_LOGIN_IP_PER_MIN: '3', TRUST_PROXY: 'true' });
  });
  afterAll(() => t.close());

  it('limits attempts per IP', async () => {
    const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    const attempt = () =>
      t.http().post('/api/v1/auth/login/staff').set('X-Forwarded-For', ip).send({ email: 'x@y.az', password: 'x', client: 'web' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('refresh', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const refresh = (refreshToken: string) => t.http().post('/api/v1/auth/refresh').send({ refreshToken });

  it('rotates the refresh token', async () => {
    const s = await signupTenant(t);
    const first = await loginStaff(t, s.email, s.password);
    const res = await refresh(first.refreshToken!);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.me.user.id).toBe(s.ownerId);
  });

  it('reuse within the grace window fails without revoking the family', async () => {
    const s = await signupTenant(t);
    const first = await loginStaff(t, s.email, s.password);
    const second = await refresh(first.refreshToken!);
    expect((await refresh(first.refreshToken!)).status).toBe(401);
    expect((await refresh(second.body.refreshToken)).status).toBe(200);
  });

  it('reuse after the grace window revokes the whole family', async () => {
    const s = await signupTenant(t);
    const first = await loginStaff(t, s.email, s.password);
    const second = await refresh(first.refreshToken!);
    await ownerQuery("update sessions set revoked_at = now() - interval '60 seconds' where replaced_by is not null and user_id = $1", [s.ownerId]);
    const reuse = await refresh(first.refreshToken!);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('UNAUTHENTICATED');
    expect((await refresh(second.body.refreshToken)).status).toBe(401);
    const audit = await ownerQuery("select 1 from audit_log where tenant_id = $1 and action = 'auth.refresh_reuse_detected'", [s.tenantId]);
    expect(audit.rowCount).toBe(1);
  });

  it('works from the web cookie and sets a new cookie', async () => {
    const s = await signupTenant(t);
    const login = await t.http().post('/api/v1/auth/login/staff').send({ email: s.email, password: s.password, client: 'web' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const res = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeNull();
    expect(String(res.headers['set-cookie'])).toContain('taskop_rt=');
  });

  it('fails for deactivated users and expired sessions', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const a = await loginWorker(t, s.orgCode, w.username!, w.secret);
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w.id]);
    expect((await refresh(a.refreshToken!)).status).toBe(401);

    const b = await loginStaff(t, s.email, s.password);
    await ownerQuery("update sessions set expires_at = now() - interval '1 second' where user_id = $1", [s.ownerId]);
    expect((await refresh(b.refreshToken!)).status).toBe(401);
  });

  it('rejects malformed tokens', async () => {
    expect((await refresh('nonsense-token')).body.error.code).toBe('UNAUTHENTICATED');
    expect((await t.http().post('/api/v1/auth/refresh').send({})).status).toBe(401);
  });
});

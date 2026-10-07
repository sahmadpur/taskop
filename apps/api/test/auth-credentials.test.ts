import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { bearer, createUserDirect, issueInvite, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('password reset', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('always answers 204 and only mails known staff', async () => {
    const before = t.mailer.sent.length;
    expect((await t.http().post('/api/v1/auth/password/forgot').send({ email: 'nobody@nowhere.az' })).status).toBe(204);
    expect(t.mailer.sent.length).toBe(before);
  });

  it('resets the password, revokes sessions and burns the token', async () => {
    const s = await signupTenant(t);
    const session = await loginStaff(t, s.email, s.password);
    await t.http().post('/api/v1/auth/password/forgot').send({ email: s.email.toUpperCase() });
    const token = await vi.waitFor(() => t.mailer.tokenFor(s.email));
    expect((await t.http().post('/api/v1/auth/password/reset').send({ token, password: 'brand new password' })).status).toBe(204);
    await loginStaff(t, s.email, 'brand new password');
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
    const again = await t.http().post('/api/v1/auth/password/reset').send({ token, password: 'another password 1' });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects expired reset tokens', async () => {
    const s = await signupTenant(t);
    await t.http().post('/api/v1/auth/password/forgot').send({ email: s.email });
    const token = await vi.waitFor(() => t.mailer.tokenFor(s.email));
    await ownerQuery("update auth_tokens set expires_at = now() - interval '1 second' where user_id = $1", [s.ownerId]);
    expect((await t.http().post('/api/v1/auth/password/reset').send({ token, password: 'brand new password' })).body.error.code).toBe(
      'TOKEN_INVALID',
    );
  });
});

describe('credential change', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('returns INVALID_CREDENTIALS (not UNAUTHENTICATED) for a wrong current secret', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const res = await t.http().post('/api/v1/auth/credential/change').set(bearer(login.accessToken)).send({ currentSecret: '000001', newSecret: '730184' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('throttles wrong current-secret attempts', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const attempt = () =>
      t.http().post('/api/v1/auth/credential/change').set(bearer(login.accessToken)).send({ currentSecret: '000001', newSecret: '730184' });
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('validates the new secret against the user credential kind', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const res = await t.http().post('/api/v1/auth/credential/change').set(bearer(login.accessToken)).send({ currentSecret: w.secret, newSecret: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({ newSecret: 'errors.validation.pinWeak' });
  });

  it('changes the PIN, keeps the current session and revokes the others', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const other = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const current = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const res = await t.http().post('/api/v1/auth/credential/change').set(bearer(current.accessToken)).send({ currentSecret: w.secret, newSecret: '730184' });
    expect(res.status).toBe(204);
    await loginWorker(t, s.orgCode, w.username!, '730184');
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: other.refreshToken })).status).toBe(401);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: current.refreshToken })).status).toBe(200);
  });
});

describe('invite acceptance', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('activates the invited user, verifies the email and logs in', async () => {
    const s = await signupTenant(t);
    const inv = await issueInvite(t, s.tenantId);
    const res = await t.http().post('/api/v1/auth/invite/accept').send({ token: inv.token, password: 'invited password 1', client: 'mobile' });
    expect(res.status).toBe(200);
    expect(res.body.me.user).toMatchObject({ id: inv.userId, emailVerified: true });
    await loginStaff(t, inv.email, 'invited password 1');
    const again = await t.http().post('/api/v1/auth/invite/accept').send({ token: inv.token, password: 'invited password 1', client: 'mobile' });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });
});

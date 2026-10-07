import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@taskop/contracts';
import { createTestApp, type TestApp } from './app';
import { signupTenant, uniq } from './fixtures';
import { ownerQuery } from './owner-db';

describe('POST /auth/signup', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('creates the tenant, its defaults and an Owner, and logs in (mobile)', async () => {
    const s = await signupTenant(t);
    expect(s.me.role.systemKey).toBe('owner');
    expect(s.me.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(s.me.user.emailVerified).toBe(false);
    expect(s.me.tenant).toMatchObject({ orgCode: s.orgCode, timezone: 'Asia/Baku', locale: 'az' });

    const types = await ownerQuery('select name from site_types where tenant_id = $1 order by sort_order', [s.tenantId]);
    expect(types.rows.map((r) => r.name)).toEqual(['Filial', 'Zona', 'Bölmə', 'Yoxlama nöqtəsi']);
    const roles = await ownerQuery('select system_key from roles where tenant_id = $1', [s.tenantId]);
    expect(roles.rows.map((r) => r.system_key).sort()).toEqual(['admin', 'auditor', 'manager', 'owner', 'worker']);
    const audit = await ownerQuery('select action from audit_log where tenant_id = $1', [s.tenantId]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['tenant.created', 'user.created']));
  });

  it('returns the refresh token in the body for mobile and as a cookie for web', async () => {
    const orgCode = uniq('org');
    const mobile = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'M', orgCode, fullName: 'Mobile User', email: `${orgCode}@m.az`, password: 'long password 1', client: 'mobile',
    });
    expect(mobile.body.refreshToken).toBeTypeOf('string');
    expect(mobile.headers['set-cookie']).toBeUndefined();

    const orgCode2 = uniq('org');
    const web = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'W', orgCode: orgCode2, fullName: 'Web User', email: `${orgCode2}@w.az`, password: 'long password 1', client: 'web',
    });
    expect(web.body.refreshToken).toBeNull();
    const cookie = String(web.headers['set-cookie']);
    expect(cookie).toContain('taskop_rt=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('rejects a taken org code', async () => {
    const s = await signupTenant(t);
    const res = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'X', orgCode: s.orgCode.toUpperCase(), fullName: 'Other', email: `${uniq('e')}@x.az`, password: 'long password 1', client: 'web',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ORG_CODE_TAKEN', fields: { orgCode: 'errors.ORG_CODE_TAKEN' } });
  });

  it('treats emails case-insensitively when checking duplicates', async () => {
    const s = await signupTenant(t);
    const res = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'X', orgCode: uniq('org'), fullName: 'Other', email: `  ${s.email.toUpperCase()} `, password: 'long password 1', client: 'web',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns field-level validation keys', async () => {
    const res = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'X', orgCode: 'a', fullName: 'Other', email: 'bad', password: 'short', client: 'web',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toMatchObject({
      orgCode: 'errors.validation.orgCode',
      email: 'errors.validation.email',
      password: 'errors.validation.passwordLength',
    });
  });
});

describe('POST /auth/verify-email', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('verifies once with the mailed token', async () => {
    const s = await signupTenant(t);
    const token = t.mailer.tokenFor(s.email);
    expect((await t.http().post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
    const row = await ownerQuery('select email_verified_at from users where id = $1', [s.ownerId]);
    expect(row.rows[0]?.email_verified_at).not.toBeNull();

    const again = await t.http().post('/api/v1/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects garbage tokens', async () => {
    const res = await t.http().post('/api/v1/auth/verify-email').send({ token: 'garbage-token-value' });
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});

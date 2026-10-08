import { randomBytes } from 'node:crypto';
import type { LoginResult, Me, SystemRoleKey } from '@taskop/contracts';
import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { PasswordHasher } from '../src/auth/crypto/password-hasher';
import { OneTimeTokenService } from '../src/auth/one-time-token.service';
import { DbService } from '../src/db/db.service';
import { roles, users } from '../src/db/schema';
import type { TestApp } from './app';
import { ownerQuery } from './owner-db';

export const uniq = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface SignedUpTenant {
  orgCode: string;
  email: string;
  password: string;
  tenantId: string;
  ownerId: string;
  accessToken: string;
  me: Me;
}

export async function signupTenant(t: TestApp, overrides: Record<string, unknown> = {}): Promise<SignedUpTenant> {
  const orgCode = uniq('org');
  const body = {
    orgName: 'Acme MMC',
    orgCode,
    fullName: 'Elvin Əhmədov',
    email: `${orgCode}@example.az`,
    password: 'owner password 1',
    client: 'mobile',
    ...overrides,
  };
  const res = await t.http().post('/api/v1/auth/signup').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const result = res.body as LoginResult;
  return {
    orgCode: String(body.orgCode),
    email: String(body.email).toLowerCase(),
    password: String(body.password),
    tenantId: result.me.tenant.id,
    ownerId: result.me.user.id,
    accessToken: result.accessToken,
    me: result.me,
  };
}

export interface DirectUserOptions {
  kind?: 'worker' | 'staff';
  roleKey?: SystemRoleKey;
  roleId?: string;
  username?: string;
  email?: string;
  secret?: string | null;
  credentialKind?: 'pin' | 'password';
  status?: 'active' | 'deactivated' | 'invited';
  fullName?: string;
  managerId?: string | null;
  emailVerified?: boolean;
}

/** Inserts a user straight into the DB (bypassing the Users API, which arrives in Task 17). */
export async function createUserDirect(t: TestApp, tenantId: string, opts: DirectUserOptions = {}) {
  const db = t.app.get(DbService);
  const hasher = t.app.get(PasswordHasher);
  const kind = opts.kind ?? 'worker';
  const credentialKind = opts.credentialKind ?? (kind === 'worker' ? 'pin' : 'password');
  const secret = opts.secret === undefined ? (credentialKind === 'pin' ? '482915' : 'staff password 1') : opts.secret;
  const username = kind === 'worker' ? (opts.username ?? uniq('w')).toLowerCase() : null;
  const email = kind === 'staff' ? (opts.email ?? `${uniq('s')}@example.az`).toLowerCase() : null;
  const credentialHash = secret ? await hasher.hash(secret) : null;
  const id = await db.withTenant(tenantId, null, async (tx) => {
    let roleId = opts.roleId;
    if (!roleId) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.systemKey, opts.roleKey ?? (kind === 'worker' ? 'worker' : 'admin'))));
      roleId = role!.id;
    }
    const [row] = await tx
      .insert(users)
      .values({
        tenantId,
        fullName: opts.fullName ?? 'Test User',
        roleId,
        kind,
        username,
        email,
        credentialHash,
        credentialKind: secret ? credentialKind : null,
        status: opts.status ?? 'active',
        managerId: opts.managerId ?? null,
        emailVerifiedAt: opts.emailVerified ? new Date() : null,
      })
      .returning({ id: users.id });
    return row!.id;
  });
  return { id, username, email, secret: secret ?? '' };
}

export async function loginWorker(t: TestApp, orgCode: string, username: string, secret: string, client = 'mobile') {
  const res = await t.http().post('/api/v1/auth/login/worker').send({ orgCode, username, secret, client });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as LoginResult;
}

export async function loginStaff(t: TestApp, email: string, password: string, client = 'mobile') {
  const res = await t.http().post('/api/v1/auth/login/staff').send({ email, password, client });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as LoginResult;
}

export async function issueInvite(t: TestApp, tenantId: string) {
  const u = await createUserDirect(t, tenantId, { kind: 'staff', roleKey: 'manager', status: 'invited', secret: null });
  const token = await t.app
    .get(DbService)
    .withTenant(tenantId, null, () => t.app.get(OneTimeTokenService).create({ tenantId, userId: u.id, purpose: 'invite' }));
  return { userId: u.id, email: u.email!, token };
}

export function as(t: TestApp, token: string) {
  return {
    get: (url: string) => t.http().get(url).set(bearer(token)),
    post: (url: string, body: object = {}) => t.http().post(url).set(bearer(token)).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set(bearer(token)).send(body),
    put: (url: string, body: object = {}) => t.http().put(url).set(bearer(token)).send(body),
  };
}

export async function roleIdOf(tenantId: string, systemKey: SystemRoleKey): Promise<string> {
  const r = await ownerQuery<{ id: string }>('select id from roles where tenant_id = $1 and system_key = $2', [tenantId, systemKey]);
  return r.rows[0]!.id;
}

export async function siteTypeIdOf(tenantId: string, name = 'Filial'): Promise<string> {
  const r = await ownerQuery<{ id: string }>('select id from site_types where tenant_id = $1 and name = $2', [tenantId, name]);
  return r.rows[0]!.id;
}

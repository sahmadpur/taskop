import { randomBytes } from 'node:crypto';
import type { LoginResult, Me } from '@taskop/contracts';
import { expect } from 'vitest';
import type { TestApp } from './app';

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

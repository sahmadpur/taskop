import { describe, expect, it } from 'vitest';
import {
  createWorkerInputSchema,
  loginWorkerInputSchema,
  meSchema,
  timezoneSchema,
  userListQuerySchema,
} from './index.js';

const id = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';

describe('createWorkerInputSchema', () => {
  const base = { fullName: 'Elvin Məmmədov', username: 'Elvin', roleId: id };
  it('defaults to pin credentials and empty assignments', () => {
    expect(createWorkerInputSchema.parse(base)).toMatchObject({
      username: 'elvin',
      credentialKind: 'pin',
      siteIds: [],
      teamIds: [],
    });
  });
  it('validates a provided secret against the credential kind', () => {
    const r = createWorkerInputSchema.safeParse({ ...base, secret: '123456' });
    expect(r.error?.issues[0]).toMatchObject({ path: ['secret'], message: 'errors.validation.pinWeak' });
  });
  it('accepts a password when kind is password', () => {
    expect(
      createWorkerInputSchema.parse({ ...base, credentialKind: 'password', secret: 'a long password' }).secret,
    ).toBe('a long password');
  });
});

describe('loginWorkerInputSchema', () => {
  it('normalises org code and username without enforcing formats', () => {
    expect(
      loginWorkerInputSchema.parse({ orgCode: ' ACME ', username: ' Elvin ', secret: 'x', client: 'mobile' }),
    ).toMatchObject({ orgCode: 'acme', username: 'elvin' });
  });
});

describe('userListQuerySchema', () => {
  it('coerces limit and defaults to 50', () => {
    expect(userListQuerySchema.parse({}).limit).toBe(50);
    expect(userListQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(userListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('timezoneSchema', () => {
  it('accepts IANA zones and rejects unknown ones', () => {
    expect(timezoneSchema.parse('Asia/Baku')).toBe('Asia/Baku');
    expect(timezoneSchema.safeParse('Mars/Base').error?.issues[0]?.message).toBe('errors.validation.timezone');
  });
});

describe('meSchema', () => {
  it('parses a full profile', () => {
    expect(
      meSchema.parse({
        user: { id, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password' },
        role: { id, name: 'Owner', systemKey: 'owner', dataScope: 'all' },
        permissions: ['users.view'],
        tenant: { id, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
      }).role.systemKey,
    ).toBe('owner');
  });
});

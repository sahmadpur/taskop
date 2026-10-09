import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  createChecklistInputSchema,
  createWorkerInputSchema,
  ERROR_HTTP_STATUS,
  errorBodySchema,
  loginWorkerInputSchema,
  meSchema,
  SYSTEM_ROLE_DEFAULTS,
  templateCategorySchema,
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

describe('checklist contracts', () => {
  it('adds the checklist permissions and role defaults', () => {
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['checklists.view', 'checklists.manage', 'checklists.publish', 'templates.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toEqual(expect.arrayContaining(['checklists.view', 'checklists.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('checklists.publish');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toContain('checklists.view');
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
  });

  it('parses create input with each source kind', () => {
    const id = '0190a4d2-7c3e-7000-8000-000000000001';
    expect(createChecklistInputSchema.parse({ name: ' Yoxlama ' })).toEqual({ name: 'Yoxlama' });
    expect(createChecklistInputSchema.parse({ name: 'A', from: { kind: 'global', templateId: id } }).from).toEqual({ kind: 'global', templateId: id });
    expect(createChecklistInputSchema.parse({ name: 'A', from: { kind: 'version', versionId: id } }).from).toEqual({ kind: 'version', versionId: id });
    expect(createChecklistInputSchema.safeParse({ name: 'A', from: { kind: 'version', templateId: id } }).success).toBe(false);
  });

  it('knows the categories', () => {
    expect(templateCategorySchema.options).toEqual(['cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other']);
  });

  it('carries issues and currentRevision on errors', () => {
    expect(ERROR_HTTP_STATUS.CHECKLIST_INVALID_CONTENT).toBe(422);
    expect(ERROR_HTTP_STATUS.CHECKLIST_CONTENT_TOO_LARGE).toBe(413);
    const body = { error: { code: 'CHECKLIST_DRAFT_CONFLICT', messageKey: 'errors.CHECKLIST_DRAFT_CONFLICT', fields: null, retryAfterSeconds: null, requestId: null, currentRevision: 4 } };
    expect(errorBodySchema.parse(body).error.currentRevision).toBe(4);
  });
});

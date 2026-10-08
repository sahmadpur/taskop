import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, roleIdOf, signupTenant } from './fixtures';

describe('roles', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lists built-in roles with permissions and user counts', async () => {
    const s = await signupTenant(t);
    const roles = (await as(t, s.accessToken).get('/api/v1/roles')).body as Array<{ systemKey: string; userCount: number; permissions: string[] }>;
    expect(roles.map((r) => r.systemKey).sort()).toEqual(['admin', 'auditor', 'manager', 'owner', 'worker']);
    expect(roles.find((r) => r.systemKey === 'owner')).toMatchObject({ userCount: 1 });
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual(['sites.view', 'teams.view', 'users.view']);
  });

  it('returns the permission catalogue', async () => {
    const s = await signupTenant(t);
    const catalog = (await as(t, s.accessToken).get('/api/v1/permissions')).body;
    expect(catalog[0]).toEqual({ group: 'tenant', keys: ['tenant.manage'] });
  });

  it('creates and edits custom roles, bumping the version', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const role = (await owner.post('/api/v1/roles', { name: 'Supervisor', dataScope: 'subordinates', permissions: ['users.view'] })).body;
    expect(role).toMatchObject({ name: 'Supervisor', systemKey: null, editable: true, permissions: ['users.view'], userCount: 0 });
    const perms = await owner.put(`/api/v1/roles/${role.id}/permissions`, { permissions: ['users.view', 'teams.view'] });
    expect(perms.body.permissions.sort()).toEqual(['teams.view', 'users.view']);
    const renamed = await owner.patch(`/api/v1/roles/${role.id}`, { name: 'Senior supervisor', dataScope: 'site_subtree' });
    expect(renamed.body).toMatchObject({ name: 'Senior supervisor', dataScope: 'site_subtree' });
  });

  it('protects the Owner role and system role names', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const ownerRole = await roleIdOf(s.tenantId, 'owner');
    expect((await owner.put(`/api/v1/roles/${ownerRole}/permissions`, { permissions: [] })).body.error.code).toBe('ROLE_NOT_EDITABLE');
    const managerRole = await roleIdOf(s.tenantId, 'manager');
    expect((await owner.patch(`/api/v1/roles/${managerRole}`, { name: 'Boss' })).body.error.code).toBe('ROLE_NOT_EDITABLE');
    expect((await owner.patch(`/api/v1/roles/${managerRole}`, { active: false })).body.error.code).toBe('ROLE_NOT_EDITABLE');
    expect((await owner.patch(`/api/v1/roles/${managerRole}`, { dataScope: 'subordinates' })).status).toBe(200);
  });

  it('refuses to deactivate a role in use', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const role = (await owner.post('/api/v1/roles', { name: 'Custom', dataScope: 'own' })).body;
    await createUserDirect(t, s.tenantId, { roleId: role.id });
    expect((await owner.patch(`/api/v1/roles/${role.id}`, { active: false })).body.error.code).toBe('ROLE_IN_USE');
  });

  it('blocks granting permissions the actor does not hold', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const roleAdmin = (await owner.post('/api/v1/roles', { name: 'Role admin', dataScope: 'all', permissions: ['roles.view', 'roles.manage'] })).body;
    const u = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: roleAdmin.id });
    const actor = as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
    const res = await actor.post('/api/v1/roles', { name: 'Sneaky', dataScope: 'all', permissions: ['audit.view'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_ESCALATION');
  });

  it('permission changes take effect on the next request', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const manager = as(t, (await loginStaff(t, m.email!, m.secret)).accessToken);
    expect((await manager.get('/api/v1/sites')).status).toBe(200);
    await owner.put(`/api/v1/roles/${await roleIdOf(s.tenantId, 'manager')}/permissions`, { permissions: ['users.view'] });
    expect((await manager.get('/api/v1/sites')).status).toBe(403);
  });
});

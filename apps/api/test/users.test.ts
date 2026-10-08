import { ALL_PERMISSIONS } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../src/common/request';
import { DbService } from '../src/db/db.service';
import { UsersService } from '../src/users/users.service';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, loginWorker, roleIdOf, signupTenant, siteTypeIdOf } from './fixtures';

describe('users', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function verified() {
    const s = await signupTenant(t);
    await t.http().post('/api/v1/auth/verify-email').send({ token: t.mailer.tokenFor(s.email) });
    return { s, owner: as(t, s.accessToken) };
  }

  it('creates a worker with a generated PIN that works for login', async () => {
    const { s, owner } = await verified();
    const res = await owner.post('/api/v1/users/workers', {
      fullName: 'Elvin Məmmədov',
      username: 'Elvin.M',
      roleId: await roleIdOf(s.tenantId, 'worker'),
      jobTitle: 'Təmizlikçi',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'elvin.m', kind: 'worker', status: 'active', credentialKind: 'pin', role: { systemKey: 'worker' } });
    expect(res.body.generatedSecret).toMatch(/^\d{6}$/);
    await loginWorker(t, s.orgCode, 'elvin.m', res.body.generatedSecret);
  });

  it('validates usernames and provided PINs', async () => {
    const { s, owner } = await verified();
    const roleId = await roleIdOf(s.tenantId, 'worker');
    const weak = await owner.post('/api/v1/users/workers', { fullName: 'A B', username: 'ali', roleId, secret: '123456' });
    expect(weak.body.error.fields).toEqual({ secret: 'errors.validation.pinWeak' });
    const az = await owner.post('/api/v1/users/workers', { fullName: 'A B', username: 'əli', roleId });
    expect(az.body.error.fields).toEqual({ username: 'errors.validation.username' });
    await owner.post('/api/v1/users/workers', { fullName: 'A B', username: 'ali', roleId });
    const dup = await owner.post('/api/v1/users/workers', { fullName: 'C D', username: 'ALI', roleId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'USERNAME_TAKEN', fields: { username: 'errors.USERNAME_TAKEN' } });
  });

  it('invites staff only after the actor verified their email, and the invite can be accepted', async () => {
    const s = await signupTenant(t);
    const managerRole = await roleIdOf(s.tenantId, 'manager');
    const body = { fullName: 'Leyla Quliyeva', email: `${uniqEmail()}`, roleId: managerRole };
    const blocked = await as(t, s.accessToken).post('/api/v1/users/invite', body);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    await t.http().post('/api/v1/auth/verify-email').send({ token: t.mailer.tokenFor(s.email) });
    const invited = await as(t, s.accessToken).post('/api/v1/users/invite', body);
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ status: 'invited', kind: 'staff' });
    const accept = await t.http().post('/api/v1/auth/invite/accept').send({ token: t.mailer.tokenFor(body.email), password: 'leyla password 1', client: 'web' });
    expect(accept.status).toBe(200);
    expect((await as(t, s.accessToken).post('/api/v1/users/invite', body)).body.error.code).toBe('EMAIL_TAKEN');
  });

  it('filters and paginates the list', async () => {
    const { s, owner } = await verified();
    const roleId = await roleIdOf(s.tenantId, 'worker');
    for (const name of ['Nərmin Əliyeva', 'Orxan Həsənov', 'Nigar Səfərli']) {
      await owner.post('/api/v1/users/workers', { fullName: name, username: name.split(' ')[0]!.toLowerCase().replace(/[^a-z]/g, 'x'), roleId });
    }
    const search = await owner.get('/api/v1/users?q=orxan');
    expect(search.body.items.map((u: { fullName: string }) => u.fullName)).toEqual(['Orxan Həsənov']);
    const byKind = await owner.get('/api/v1/users?kind=worker');
    expect(byKind.body.items).toHaveLength(3);
    const page1 = await owner.get('/api/v1/users?limit=2');
    expect(page1.body.items).toHaveLength(2);
    const page2 = await owner.get(`/api/v1/users?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
    const wildcard = await owner.get('/api/v1/users?q=%25');
    expect(wildcard.body.items).toHaveLength(0);
  });

  it('applies the manager site scope to reads and writes', async () => {
    const { s, owner } = await verified();
    const typeId = await siteTypeIdOf(s.tenantId);
    const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'A' })).body;
    const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'A1' })).body;
    const b = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'B' })).body;
    const scopedRole = (await owner.post('/api/v1/roles', { name: 'Site lead', dataScope: 'site_subtree', permissions: ['users.view', 'users.manage'] })).body;
    const roleId = await roleIdOf(s.tenantId, 'worker');
    const inA = (await owner.post('/api/v1/users/workers', { fullName: 'In A', username: 'in-a', roleId, siteIds: [a1.id] })).body.user;
    const inB = (await owner.post('/api/v1/users/workers', { fullName: 'In B', username: 'in-b', roleId, siteIds: [b.id] })).body.user;
    const lead = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: scopedRole.id });
    await owner.put(`/api/v1/users/${lead.id}/sites`, { siteIds: [a.id] });
    const leadApi = as(t, (await loginStaff(t, lead.email!, lead.secret)).accessToken);

    const ids = (await leadApi.get('/api/v1/users')).body.items.map((u: { id: string }) => u.id).sort();
    expect(ids).toEqual([inA.id, lead.id].sort());
    expect((await leadApi.get(`/api/v1/users/${inB.id}`)).status).toBe(404);
    expect((await leadApi.patch(`/api/v1/users/${inB.id}`, { fullName: 'Changed' })).status).toBe(404);
    expect((await leadApi.patch(`/api/v1/users/${inA.id}`, { fullName: 'Changed' })).status).toBe(200);
  });

  it('requires users.manage for writes', async () => {
    const { s } = await verified();
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const manager = as(t, (await loginStaff(t, m.email!, m.secret)).accessToken);
    const res = await manager.post('/api/v1/users/workers', { fullName: 'X Y', username: 'xyz', roleId: await roleIdOf(s.tenantId, 'worker') });
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents manager cycles', async () => {
    const { s, owner } = await verified();
    const roleId = await roleIdOf(s.tenantId, 'worker');
    const a = (await owner.post('/api/v1/users/workers', { fullName: 'A A', username: 'aaa', roleId })).body.user;
    const bRes = await owner.post('/api/v1/users/workers', { fullName: 'B B', username: 'bbb', roleId, managerId: a.id }); const b = bRes.body.user;
    expect(b.managerName).toBe('A A');
    expect((await owner.patch(`/api/v1/users/${a.id}`, { managerId: b.id })).body.error.code).toBe('MANAGER_CYCLE');
    expect((await owner.patch(`/api/v1/users/${a.id}`, { managerId: a.id })).body.error.code).toBe('MANAGER_CYCLE');
    expect((await owner.patch(`/api/v1/users/${b.id}`, { managerId: null })).body.managerId).toBeNull();
  });

  it('refuses self-destructive and privilege-escalating changes', async () => {
    const { s, owner } = await verified();
    expect((await owner.post(`/api/v1/users/${s.ownerId}/deactivate`)).body.error.code).toBe('SELF_MODIFICATION');
    expect((await owner.patch(`/api/v1/users/${s.ownerId}`, { roleId: await roleIdOf(s.tenantId, 'admin') })).body.error.code).toBe(
      'SELF_MODIFICATION',
    );

    const admin = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'admin', emailVerified: true });
    const adminApi = as(t, (await loginStaff(t, admin.email!, admin.secret)).accessToken);
    const w = await createUserDirect(t, s.tenantId);
    expect((await adminApi.patch(`/api/v1/users/${w.id}`, { roleId: await roleIdOf(s.tenantId, 'owner') })).body.error.code).toBe(
      'OWNER_ROLE_RESTRICTED',
    );
    expect((await adminApi.post(`/api/v1/users/${s.ownerId}/deactivate`)).body.error.code).toBe('OWNER_ROLE_RESTRICTED');

    const limited = (await owner.post('/api/v1/roles', { name: 'HR', dataScope: 'all', permissions: ['users.view', 'users.manage'] })).body;
    const hr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: limited.id });
    const hrApi = as(t, (await loginStaff(t, hr.email!, hr.secret)).accessToken);
    expect((await hrApi.patch(`/api/v1/users/${w.id}`, { roleId: await roleIdOf(s.tenantId, 'admin') })).body.error.code).toBe(
      'ROLE_ESCALATION',
    );
  });

  it('keeps at least one active owner (service-level guard)', async () => {
    const { s } = await verified();
    const synthetic: Principal = {
      userId: uuidv7(),
      tenantId: s.tenantId,
      roleId: await roleIdOf(s.tenantId, 'owner'),
      roleVersion: 1,
      systemRoleKey: 'owner',
      sessionId: uuidv7(),
      kind: 'staff',
      dataScope: 'all',
      permissions: new Set(ALL_PERMISSIONS),
      emailVerified: true,
    };
    await expect(
      t.app.get(DbService).withTenant(s.tenantId, synthetic.userId, () => t.app.get(UsersService).deactivate(synthetic, s.ownerId)),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });

  it('deactivation revokes access immediately and reactivation restores it', async () => {
    const { s, owner } = await verified();
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    expect((await owner.post(`/api/v1/users/${w.id}/deactivate`)).body.status).toBe('deactivated');
    expect((await as(t, login.accessToken).get('/api/v1/me')).status).toBe(401);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken })).status).toBe(401);
    expect((await owner.post(`/api/v1/users/${w.id}/reactivate`)).body.status).toBe('active');
    await loginWorker(t, s.orgCode, w.username!, w.secret);
  });

  it('resets worker PINs and mails staff a reset link', async () => {
    const { s, owner } = await verified();
    const w = await createUserDirect(t, s.tenantId);
    const reset = await owner.post(`/api/v1/users/${w.id}/reset-credential`);
    expect(reset.body.generatedSecret).toMatch(/^\d{6}$/);
    expect((await t.http().post('/api/v1/auth/login/worker').send({ orgCode: s.orgCode, username: w.username, secret: w.secret, client: 'mobile' })).status).toBe(401);
    await loginWorker(t, s.orgCode, w.username!, reset.body.generatedSecret);

    const chosen = await owner.post(`/api/v1/users/${w.id}/reset-credential`, { credentialKind: 'password', secret: 'worker password 1' });
    expect(chosen.body.generatedSecret).toBeNull();
    expect(chosen.body.user.credentialKind).toBe('password');

    const staff = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const staffReset = await owner.post(`/api/v1/users/${staff.id}/reset-credential`);
    expect(staffReset.body.generatedSecret).toBeNull();
    expect(t.mailer.lastTo(staff.email!)?.subject).toContain('şifrənin bərpası');
  });

  it('assigns sites and teams, rejecting foreign ids', async () => {
    const { s, owner } = await verified();
    const other = await signupTenant(t);
    const typeId = await siteTypeIdOf(s.tenantId);
    const site = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'S' })).body;
    const team = (await owner.post('/api/v1/teams', { name: 'T' })).body;
    const w = await createUserDirect(t, s.tenantId);
    expect((await owner.put(`/api/v1/users/${w.id}/sites`, { siteIds: [site.id] })).body.siteIds).toEqual([site.id]);
    expect((await owner.put(`/api/v1/users/${w.id}/teams`, { teamIds: [team.id] })).body.teamIds).toEqual([team.id]);
    const foreignSite = (await as(t, other.accessToken).post('/api/v1/sites', { parentId: null, typeId: await siteTypeIdOf(other.tenantId), name: 'F' })).body;
    expect((await owner.put(`/api/v1/users/${w.id}/sites`, { siteIds: [foreignSite.id] })).status).toBe(422);
  });

  describe('target privilege, owner and scope rules', () => {
    it('refuses resetting the credential of a user whose role exceeds the actor', async () => {
      const { s, owner } = await verified();
      const limited = (await owner.post('/api/v1/roles', { name: 'HR', dataScope: 'all', permissions: ['users.view', 'users.manage'] })).body;
      const hr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: limited.id });
      const hrApi = as(t, (await loginStaff(t, hr.email!, hr.secret)).accessToken);
      const adminWorker = (await owner.post('/api/v1/users/workers', { fullName: 'Ad Min', username: 'admin-w', roleId: await roleIdOf(s.tenantId, 'admin') })).body.user;
      const res = await hrApi.post(`/api/v1/users/${adminWorker.id}/reset-credential`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROLE_ESCALATION');
      const plain = await createUserDirect(t, s.tenantId);
      expect((await hrApi.post(`/api/v1/users/${plain.id}/reset-credential`)).status).toBe(200);
    });

    it('refuses granting a role with a broader data scope', async () => {
      const { s, owner } = await verified();
      const typeId = await siteTypeIdOf(s.tenantId);
      const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'A' })).body;
      const perms = ['users.view', 'users.manage'];
      const narrow = (await owner.post('/api/v1/roles', { name: 'Site lead', dataScope: 'site_subtree', permissions: perms })).body;
      const wide = (await owner.post('/api/v1/roles', { name: 'Wide lead', dataScope: 'all', permissions: perms })).body;
      const w = (await owner.post('/api/v1/users/workers', { fullName: 'In A', username: 'in-a', roleId: await roleIdOf(s.tenantId, 'worker'), siteIds: [a.id] })).body.user;
      const lead = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: narrow.id });
      await owner.put(`/api/v1/users/${lead.id}/sites`, { siteIds: [a.id] });
      const leadApi = as(t, (await loginStaff(t, lead.email!, lead.secret)).accessToken);
      const res = await leadApi.patch(`/api/v1/users/${w.id}`, { roleId: wide.id });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROLE_ESCALATION');
    });

    it('stops an admin from editing the owner', async () => {
      const { s } = await verified();
      const admin = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'admin', emailVerified: true });
      const adminApi = as(t, (await loginStaff(t, admin.email!, admin.secret)).accessToken);
      const patch = await adminApi.patch(`/api/v1/users/${s.ownerId}`, { fullName: 'Hacked' });
      expect(patch.status).toBe(403);
      expect(patch.body.error.code).toBe('OWNER_ROLE_RESTRICTED');
      const put = await adminApi.put(`/api/v1/users/${s.ownerId}/sites`, { siteIds: [] });
      expect(put.status).toBe(403);
      expect(put.body.error.code).toBe('OWNER_ROLE_RESTRICTED');
    });

    it('confines site-subtree leads to their own subtree', async () => {
      const { s, owner } = await verified();
      const typeId = await siteTypeIdOf(s.tenantId);
      const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'A' })).body;
      const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'A1' })).body;
      const b = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'B' })).body;
      const role = (await owner.post('/api/v1/roles', { name: 'Site lead', dataScope: 'site_subtree', permissions: ['users.view', 'users.manage'] })).body;
      const roleId = await roleIdOf(s.tenantId, 'worker');
      const inA = (await owner.post('/api/v1/users/workers', { fullName: 'In A', username: 'in-a', roleId, siteIds: [a1.id] })).body.user;
      const lead = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: role.id });
      await owner.put(`/api/v1/users/${lead.id}/sites`, { siteIds: [a.id] });
      const leadApi = as(t, (await loginStaff(t, lead.email!, lead.secret)).accessToken);

      const self = await leadApi.put(`/api/v1/users/${lead.id}/sites`, { siteIds: [b.id] });
      expect(self.status).toBe(409);
      expect(self.body.error.code).toBe('SELF_MODIFICATION');
      expect((await leadApi.put(`/api/v1/users/${inA.id}/sites`, { siteIds: [b.id] })).status).toBe(422);

      const none = await leadApi.post('/api/v1/users/workers', { fullName: 'No Site', username: 'no-site', roleId });
      expect(none.status).toBe(400);
      expect(none.body.error.fields).toHaveProperty('siteIds');
      const ok = await leadApi.post('/api/v1/users/workers', { fullName: 'With Site', username: 'with-site', roleId, siteIds: [a1.id] });
      expect(ok.status).toBe(201);
      const ids = (await leadApi.get('/api/v1/users')).body.items.map((u: { id: string }) => u.id);
      expect(ids).toContain(ok.body.user.id);
    });
  });
});

function uniqEmail() {
  return `${uuidv7().slice(-12)}@example.az`;
}

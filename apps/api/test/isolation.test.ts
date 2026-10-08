import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, roleIdOf, signupTenant, siteTypeIdOf, type SignedUpTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('tenant isolation', () => {
  let t: TestApp;
  let A: SignedUpTenant;
  let B: SignedUpTenant;
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    A = await signupTenant(t);
    B = await signupTenant(t);
    const apiA = as(t, A.accessToken);
    a.type = await siteTypeIdOf(A.tenantId);
    a.site = (await apiA.post('/api/v1/sites', { parentId: null, typeId: a.type, name: 'A site' })).body.id;
    a.team = (await apiA.post('/api/v1/teams', { name: 'A team' })).body.id;
    a.role = (await apiA.post('/api/v1/roles', { name: 'A role', dataScope: 'own' })).body.id;
    a.worker = (await createUserDirect(t, A.tenantId, { username: 'shared-name' })).id;
    b.type = await siteTypeIdOf(B.tenantId);
    b.worker = (await createUserDirect(t, B.tenantId, { username: 'b-worker' })).id;
    b.team = (await as(t, B.accessToken).post('/api/v1/teams', { name: 'B team' })).body.id;
    b.workerRole = await roleIdOf(B.tenantId, 'worker');
  });
  afterAll(() => t.close());

  const notFound = () => [
    ['PATCH', () => `/api/v1/sites/${a.site}`, { name: 'x' }],
    ['POST', () => `/api/v1/sites/${a.site}/move`, { parentId: null }],
    ['PATCH', () => `/api/v1/site-types/${a.type}`, { name: 'x' }],
    ['PATCH', () => `/api/v1/teams/${a.team}`, { name: 'x' }],
    ['PUT', () => `/api/v1/teams/${a.team}/members`, { userIds: [] }],
    ['PATCH', () => `/api/v1/roles/${a.role}`, { name: 'xx' }],
    ['PUT', () => `/api/v1/roles/${a.role}/permissions`, { permissions: [] }],
    ['GET', () => `/api/v1/users/${a.worker}`, undefined],
    ['PATCH', () => `/api/v1/users/${a.worker}`, { fullName: 'Hacked Name' }],
    ['POST', () => `/api/v1/users/${a.worker}/deactivate`, {}],
    ['POST', () => `/api/v1/users/${a.worker}/reactivate`, {}],
    ['POST', () => `/api/v1/users/${a.worker}/reset-credential`, {}],
    ['PUT', () => `/api/v1/users/${a.worker}/sites`, { siteIds: [] }],
    ['PUT', () => `/api/v1/users/${a.worker}/teams`, { teamIds: [] }],
  ] as const;

  it.each(notFound().map((c) => [c[0], c[1], c[2]] as const))('%s on a foreign id returns 404', async (method, url, body) => {
    const api = as(t, B.accessToken);
    const path = url();
    const res =
      method === 'GET' ? await api.get(path) : method === 'POST' ? await api.post(path, body) : method === 'PUT' ? await api.put(path, body) : await api.patch(path, body);
    expect(res.status, `${method} ${path}`).toBe(404);
  });

  it('rejects foreign ids inside request bodies with 422', async () => {
    const api = as(t, B.accessToken);
    const cases = [
      await api.post('/api/v1/sites', { parentId: null, typeId: a.type, name: 'x' }),
      await api.post('/api/v1/sites', { parentId: a.site, typeId: b.type, name: 'x' }),
      await api.put(`/api/v1/teams/${b.team}/members`, { userIds: [a.worker] }),
      await api.put(`/api/v1/users/${b.worker}/sites`, { siteIds: [a.site] }),
      await api.put(`/api/v1/users/${b.worker}/teams`, { teamIds: [a.team] }),
      await api.patch(`/api/v1/users/${b.worker}`, { managerId: a.worker }),
      await api.post('/api/v1/users/workers', { fullName: 'X Y', username: 'xy-iso', roleId: a.role }),
      await api.post('/api/v1/users/workers', { fullName: 'X Y', username: 'xy-iso2', roleId: b.workerRole, siteIds: [a.site] }),
    ];
    for (const res of cases) expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it('lists never include the other tenant', async () => {
    const api = as(t, B.accessToken);
    const aIds = new Set(Object.values(a));
    for (const url of ['/api/v1/sites', '/api/v1/site-types', '/api/v1/teams', '/api/v1/roles']) {
      const ids = ((await api.get(url)).body as Array<{ id: string }>).map((x) => x.id);
      expect(ids.filter((id) => aIds.has(id)), url).toEqual([]);
    }
    for (const url of ['/api/v1/users?limit=200', '/api/v1/audit-log?limit=200']) {
      const items = (await api.get(url)).body.items as Array<{ id: string; entityId?: string }>;
      expect(items.filter((x) => aIds.has(x.id) || (x.entityId && aIds.has(x.entityId))), url).toEqual([]);
    }
  });

  it('worker login cannot cross tenants', async () => {
    const res = await t.http().post('/api/v1/auth/login/worker').send({ orgCode: B.orgCode, username: 'shared-name', secret: '482915', client: 'mobile' });
    expect(res.status).toBe(401);
  });

  it('left tenant A untouched', async () => {
    const site = await ownerQuery('select name from sites where id = $1', [a.site]);
    expect(site.rows[0]?.name).toBe('A site');
    const worker = await ownerQuery('select full_name, status from users where id = $1', [a.worker]);
    expect(worker.rows[0]).toMatchObject({ full_name: 'Test User', status: 'active' });
  });
});

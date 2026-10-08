import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, roleIdOf, signupTenant, siteTypeIdOf, type SignedUpTenant } from './fixtures';
import { sampleContent } from './checklist-fixtures';
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
    const ca = await apiA.post('/api/v1/checklists', { name: 'A checklist' });
    a.checklist = ca.body.id;
    await apiA.put(`/api/v1/checklists/${a.checklist}/draft`, { content: sampleContent(), revision: 1 });
    a.version = (await apiA.post(`/api/v1/checklists/${a.checklist}/publish`, { revision: 2 })).body.id;
    await apiA.post(`/api/v1/checklists/${a.checklist}/draft`, {});
    a.template = (
      await apiA.post(`/api/v1/checklists/${a.checklist}/versions/${a.version}/save-as-template`, {
        name: 'A tpl',
        category: 'other',
      })
    ).body.id;
    b.checklist = (await as(t, B.accessToken).post('/api/v1/checklists', { name: 'B checklist' })).body.id;
    await as(t, B.accessToken).delete(`/api/v1/checklists/${b.checklist}/draft`);
    const apiB = as(t, B.accessToken);
    const cb2 = (await apiB.post('/api/v1/checklists', { name: 'B published' })).body.id;
    await apiB.put(`/api/v1/checklists/${cb2}/draft`, { content: sampleContent(), revision: 1 });
    b.version = (await apiB.post(`/api/v1/checklists/${cb2}/publish`, { revision: 2 })).body.id;
  });
  afterAll(() => t.close());

  const notFound = () =>
    [
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

  it.each(notFound().map((c) => [c[0], c[1], c[2]] as const))(
    '%s on a foreign id returns 404',
    async (method, url, body) => {
      const api = as(t, B.accessToken);
      const path = url();
      const res =
        method === 'GET'
          ? await api.get(path)
          : method === 'POST'
            ? await api.post(path, body)
            : method === 'PUT'
              ? await api.put(path, body)
              : await api.patch(path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    },
  );

  const checklistNotFound = () =>
    [
      ['GET', () => `/api/v1/checklists/${a.checklist}`, undefined],
      ['PATCH', () => `/api/v1/checklists/${a.checklist}`, { name: 'x' }],
      ['GET', () => `/api/v1/checklists/${a.checklist}/versions/${a.version}`, undefined],
      ['GET', () => `/api/v1/checklists/${b.checklist}/versions/${a.version}`, undefined],
      ['GET', () => `/api/v1/checklists/${a.checklist}/draft`, undefined],
      ['POST', () => `/api/v1/checklists/${a.checklist}/draft`, {}],
      ['PUT', () => `/api/v1/checklists/${a.checklist}/draft`, { content: sampleContent(), revision: 1 }],
      ['POST', () => `/api/v1/checklists/${a.checklist}/publish`, { revision: 1 }],
      ['POST', () => `/api/v1/checklists/${a.checklist}/deactivate`, {}],
      ['POST', () => `/api/v1/checklists/${a.checklist}/reactivate`, {}],
      [
        'POST',
        () => `/api/v1/checklists/${a.checklist}/versions/${a.version}/save-as-template`,
        { name: 'x', category: 'other' },
      ],
      [
        'POST',
        () => `/api/v1/checklists/${b.checklist}/versions/${a.version}/save-as-template`,
        { name: 'x', category: 'other' },
      ],
      ['GET', () => `/api/v1/templates/tenant/${a.template}`, undefined],
      ['PATCH', () => `/api/v1/templates/${a.template}`, { name: 'x' }],
      ['PUT', () => `/api/v1/templates/${a.template}/content`, { content: sampleContent(), revision: 1 }],
      ['POST', () => `/api/v1/templates/${a.template}/deactivate`, {}],
      ['DELETE', () => `/api/v1/checklists/${a.checklist}/draft`, undefined],
      ['POST', () => `/api/v1/templates/${a.template}/reactivate`, {}],
    ] as const;

  it.each(checklistNotFound().map((c) => [c[0], c[1], c[2]] as const))(
    '%s on a foreign checklist/template id returns 404 NOT_FOUND',
    async (method, url, body) => {
      const api = as(t, B.accessToken);
      const path = url();
      const res =
        method === 'GET'
          ? await api.get(path)
          : method === 'POST'
            ? await api.post(path, body)
            : method === 'PUT'
              ? await api.put(path, body)
              : method === 'DELETE'
                ? await api.delete(path)
                : await api.patch(path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code, `${method} ${path}`).toBe('NOT_FOUND');
    },
  );

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
      await api.post('/api/v1/users/workers', {
        fullName: 'X Y',
        username: 'xy-iso2',
        roleId: b.workerRole,
        siteIds: [a.site],
      }),
      await api.post('/api/v1/checklists', { name: 'x', from: { kind: 'version', versionId: a.version } }),
      await api.post('/api/v1/checklists', { name: 'x', from: { kind: 'tenant', templateId: a.template } }),
      await api.post(`/api/v1/checklists/${b.checklist}/draft`, { fromVersionId: a.version }),
    ];
    for (const res of cases) expect(res.status, JSON.stringify(res.body)).toBe(422);
    for (const res of cases.slice(-3)) expect(res.body.error.code).toBe('REFERENCE_NOT_FOUND');
    const own = await api.post('/api/v1/checklists', {
      name: 'own copy',
      from: { kind: 'version', versionId: b.version },
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
  });

  it('lists never include the other tenant', async () => {
    const api = as(t, B.accessToken);
    const aIds = new Set(Object.values(a));
    for (const url of [
      '/api/v1/sites',
      '/api/v1/site-types',
      '/api/v1/teams',
      '/api/v1/roles',
      '/api/v1/templates',
    ]) {
      const ids = ((await api.get(url)).body as Array<{ id: string }>).map((x) => x.id);
      expect(
        ids.filter((id) => aIds.has(id)),
        url,
      ).toEqual([]);
    }
    for (const url of [
      '/api/v1/users?limit=200',
      '/api/v1/audit-log?limit=200',
      '/api/v1/checklists?limit=200',
    ]) {
      const items = (await api.get(url)).body.items as Array<{ id: string; entityId?: string }>;
      expect(
        items.filter((x) => aIds.has(x.id) || (x.entityId && aIds.has(x.entityId))),
        url,
      ).toEqual([]);
    }
  });

  it('worker login cannot cross tenants', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/login/worker')
      .send({ orgCode: B.orgCode, username: 'shared-name', secret: '482915', client: 'mobile' });
    expect(res.status).toBe(401);
  });

  it('left tenant A untouched', async () => {
    const site = await ownerQuery('select name from sites where id = $1', [a.site]);
    expect(site.rows[0]?.name).toBe('A site');
    const worker = await ownerQuery('select full_name, status from users where id = $1', [a.worker]);
    expect(worker.rows[0]).toMatchObject({ full_name: 'Test User', status: 'active' });
    const c = await ownerQuery('select name, latest_version_number, status from checklists where id = $1', [
      a.checklist,
    ]);
    expect(c.rows[0]).toEqual({ name: 'A checklist', latest_version_number: 1, status: 'active' });
    const tpl = await ownerQuery('select name from tenant_templates where id = $1', [a.template]);
    expect(tpl.rows[0]?.name).toBe('A tpl');
  });
});

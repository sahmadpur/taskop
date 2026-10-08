import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, loginWorker, signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

describe('tenant settings', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('reads and updates name and timezone, with audit', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    expect((await owner.get('/api/v1/tenant')).body).toMatchObject({ orgCode: s.orgCode, timezone: 'Asia/Baku' });
    const bad = await owner.patch('/api/v1/tenant', { timezone: 'Mars/Base' });
    expect(bad.body.error.fields).toEqual({ timezone: 'errors.validation.timezone' });
    const ok = await owner.patch('/api/v1/tenant', { name: 'Acme Group', timezone: 'Europe/Istanbul' });
    expect(ok.body).toMatchObject({ name: 'Acme Group', timezone: 'Europe/Istanbul' });
    const audit = await ownerQuery("select before, after from audit_log where tenant_id = $1 and action = 'tenant.updated'", [s.tenantId]);
    expect(audit.rows[0]).toMatchObject({ before: { timezone: 'Asia/Baku' }, after: { timezone: 'Europe/Istanbul' } });
  });

  it('only tenant.manage may update', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    expect((await as(t, login.accessToken).get('/api/v1/tenant')).status).toBe(200);
    expect((await as(t, login.accessToken).patch('/api/v1/tenant', { name: 'Hacked' })).body.error.code).toBe('FORBIDDEN');
  });
});

describe('site types and sites', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('manages site types', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const created = await owner.post('/api/v1/site-types', { name: 'Anbar', sortOrder: 10 });
    expect(created.status).toBe(201);
    const updated = await owner.patch(`/api/v1/site-types/${created.body.id}`, { active: false });
    expect(updated.body.active).toBe(false);
    const list = await owner.get('/api/v1/site-types');
    expect(list.body.map((x: { name: string }) => x.name)).toEqual(['Filial', 'Zona', 'Bölmə', 'Yoxlama nöqtəsi', 'Anbar']);
  });

  it('builds a tree and moves subtrees, updating descendant paths', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const typeId = await siteTypeIdOf(s.tenantId);
    const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial A' })).body;
    const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'Zona A1', address: 'Bakı' })).body;
    const a11 = (await owner.post('/api/v1/sites', { parentId: a1.id, typeId, name: 'Bölmə A1.1' })).body;
    const b = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial B' })).body;
    expect(a11).toMatchObject({ parentId: a1.id, depth: 2 });

    const moved = await owner.post(`/api/v1/sites/${a1.id}/move`, { parentId: b.id });
    expect(moved.body).toMatchObject({ parentId: b.id, depth: 1 });
    const list = (await owner.get('/api/v1/sites')).body as Array<{ id: string; path: string; depth: number }>;
    const child = list.find((x) => x.id === a11.id)!;
    expect(child.path.startsWith(moved.body.path + '.')).toBe(true);
    expect(child.depth).toBe(2);

    const toRoot = await owner.post(`/api/v1/sites/${a1.id}/move`, { parentId: null });
    expect(toRoot.body).toMatchObject({ parentId: null, depth: 0 });
  });

  it('refuses to move a site under itself or its descendant', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const typeId = await siteTypeIdOf(s.tenantId);
    const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'A' })).body;
    const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'A1' })).body;
    expect((await owner.post(`/api/v1/sites/${a.id}/move`, { parentId: a1.id })).body.error.code).toBe('SITE_CYCLE');
    expect((await owner.post(`/api/v1/sites/${a.id}/move`, { parentId: a.id })).body.error.code).toBe('SITE_CYCLE');
  });

  it('serialises concurrent moves so two sites cannot be moved under each other', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const typeId = await siteTypeIdOf(s.tenantId);
    const pairs = [];
    for (let i = 0; i < 8; i++) {
      const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: `A${i}` })).body;
      const b = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: `B${i}` })).body;
      pairs.push([a.id as string, b.id as string] as const);
    }
    const results = await Promise.all(
      pairs.map(async ([a, b]) =>
        Promise.all([owner.post(`/api/v1/sites/${a}/move`, { parentId: b }), owner.post(`/api/v1/sites/${b}/move`, { parentId: a })]),
      ),
    );
    for (const pair of results) {
      expect(pair.map((r) => r.status).sort()).toEqual([200, 409]);
    }
  });

  it('rejects inactive or foreign site types', async () => {
    const s = await signupTenant(t);
    const other = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const foreignType = await siteTypeIdOf(other.tenantId);
    expect((await owner.post('/api/v1/sites', { parentId: null, typeId: foreignType, name: 'X' })).status).toBe(422);
    const inactive = (await owner.post('/api/v1/site-types', { name: 'Old' })).body;
    await owner.patch(`/api/v1/site-types/${inactive.id}`, { active: false });
    expect((await owner.post('/api/v1/sites', { parentId: null, typeId: inactive.id, name: 'X' })).body.error.code).toBe(
      'REFERENCE_NOT_FOUND',
    );
  });

  it('enforces sites.view / sites.manage', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const worker = as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken);
    expect((await worker.get('/api/v1/sites')).status).toBe(403);
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const manager = as(t, (await loginStaff(t, m.email!, m.secret)).accessToken);
    expect((await manager.get('/api/v1/sites')).status).toBe(200);
    const typeId = await siteTypeIdOf(s.tenantId);
    expect((await manager.post('/api/v1/sites', { parentId: null, typeId, name: 'X' })).status).toBe(403);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    expect((await owner.patch('/api/v1/sites/not-a-uuid', { name: 'x' })).status).toBe(404);
    expect((await owner.patch('/api/v1/sites/0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', { name: 'x' })).status).toBe(404);
  });
});

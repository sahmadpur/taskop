import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';

describe('GET /audit-log', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lists entries newest first with actor names and filters', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    await owner.post('/api/v1/teams', { name: 'Audit me' });
    const all = (await owner.get('/api/v1/audit-log')).body;
    expect(all.items[0]).toMatchObject({ action: 'team.created', actor: { type: 'user', id: s.ownerId, name: 'Elvin Əhmədov' } });
    expect(all.items[0].after).toMatchObject({ name: 'Audit me' });

    const filtered = (await owner.get('/api/v1/audit-log?action=tenant.created')).body;
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].actor.type).toBe('user');

    const page = (await owner.get('/api/v1/audit-log?limit=1')).body;
    const next = (await owner.get(`/api/v1/audit-log?limit=1&cursor=${page.nextCursor}`)).body;
    expect(next.items[0].id < page.items[0].id).toBe(true);

    const future = (await owner.get(`/api/v1/audit-log?from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).body;
    expect(future.items).toHaveLength(0);
  });

  it('allows auditors and blocks workers', async () => {
    const s = await signupTenant(t);
    const a = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'auditor' });
    expect((await as(t, (await loginStaff(t, a.email!, a.secret)).accessToken).get('/api/v1/audit-log')).status).toBe(200);
    const w = await createUserDirect(t, s.tenantId);
    expect((await as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken).get('/api/v1/audit-log')).status).toBe(403);
  });
});

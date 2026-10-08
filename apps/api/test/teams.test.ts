import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginWorker, signupTenant } from './fixtures';

describe('teams', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('creates, updates and lists teams with members', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const w1 = await createUserDirect(t, s.tenantId);
    const w2 = await createUserDirect(t, s.tenantId);
    const team = (await owner.post('/api/v1/teams', { name: 'Təmizlik', description: 'Səhər növbəsi' })).body;
    expect(team).toMatchObject({ name: 'Təmizlik', active: true, memberIds: [] });
    const members = await owner.put(`/api/v1/teams/${team.id}/members`, { userIds: [w1.id, w2.id, w1.id] });
    expect(members.body.memberIds.sort()).toEqual([w1.id, w2.id].sort());
    await owner.put(`/api/v1/teams/${team.id}/members`, { userIds: [w2.id] });
    const updated = await owner.patch(`/api/v1/teams/${team.id}`, { name: 'Təmizlik qrupu', active: false });
    expect(updated.body).toMatchObject({ name: 'Təmizlik qrupu', active: false, memberIds: [w2.id] });
    expect((await owner.get('/api/v1/teams')).body).toHaveLength(1);
  });

  it('rejects members from another tenant', async () => {
    const s = await signupTenant(t);
    const other = await signupTenant(t);
    const foreign = await createUserDirect(t, other.tenantId);
    const owner = as(t, s.accessToken);
    const team = (await owner.post('/api/v1/teams', { name: 'X' })).body;
    expect((await owner.put(`/api/v1/teams/${team.id}/members`, { userIds: [foreign.id] })).status).toBe(422);
  });

  it('forbids workers', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const worker = as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken);
    expect((await worker.get('/api/v1/teams')).status).toBe(403);
  });
});

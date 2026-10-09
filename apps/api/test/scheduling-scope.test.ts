import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, loginWorker, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, daily, fixed, MONDAY_0800, occurrenceRows, type SchedulingWorld, schedulingWorld, staffWithRole, TODAY } from './scheduling-fixtures';

const RANGE = `from=${TODAY}&to=2026-11-30&limit=200`;
const ids = (items: Array<{ id: string }>) => items.map((x) => x.id).sort();

describe('scheduling data scope', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: SchedulingWorld;
  let bWorker: string;
  let atA: string;
  let atB: string;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await schedulingWorld(t);
    bWorker = (await createUserDirect(t, w.s.tenantId, { fullName: 'B işçisi' })).id;
    await w.api.put(`/api/v1/users/${bWorker}/sites`, { siteIds: [w.otherSiteId] });
    atA = (await createAssignment(w)).id;
    atB = (await createAssignment(w, { siteId: w.otherSiteId, assigneeIds: [bWorker] })).id;
  });
  afterAll(() => t.close());

  it('limits a site_subtree manager to their sites for reads and writes', async () => {
    const m = await staffWithRole(t, w, 'manager', [w.siteId]);
    expect(ids((await m.api.get('/api/v1/assignments')).body.items)).toEqual([atA]);
    const occ = (await m.api.get(`/api/v1/occurrences?${RANGE}`)).body.items as Array<{ siteId: string }>;
    expect(occ.length).toBe(15);
    expect(occ.every((o) => o.siteId === w.siteId)).toBe(true);
    expect((await m.api.get(`/api/v1/assignments/${atB}`)).status).toBe(404);
    expect((await m.api.post(`/api/v1/assignments/${atB}/pause`)).status).toBe(404);
    const bOccurrence = (await occurrenceRows(atB))[0]!.id;
    expect((await m.api.post(`/api/v1/occurrences/${bOccurrence}/cancel`, { reason: 'x' })).status).toBe(404);
    const create = await m.api.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.otherSiteId, assigneeIds: [bWorker], schedule: daily(), timing: fixed() });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.post('/api/v1/assignments/preview', { siteId: w.otherSiteId, schedule: daily(), timing: fixed() })).body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.get(`/api/v1/roster?siteId=${w.otherSiteId}&from=${TODAY}&to=2026-11-08`)).body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.put('/api/v1/roster', { siteId: w.otherSiteId, from: TODAY, to: TODAY, rows: [] })).body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.get(`/api/v1/roster?siteId=${w.siteId}&from=${TODAY}&to=2026-11-08`)).status).toBe(200);
  });

  it('limits own and subordinates scopes to people, and makes them read-only', async () => {
    const roles = w.api;
    const viewer = (await roles.post('/api/v1/roles', { name: uniq('Öz'), dataScope: 'own', permissions: ['assignments.view'] })).body.id;
    const lead = (
      await roles.post('/api/v1/roles', { name: uniq('Rəhbər'), dataScope: 'subordinates', permissions: ['assignments.view', 'assignments.manage', 'checklists.view'] })
    ).body.id;

    const worker = await createUserDirect(t, w.s.tenantId, { roleId: viewer, fullName: 'Öz baxan' });
    await w.api.put(`/api/v1/users/${worker.id}/sites`, { siteIds: [w.siteId] });
    const mine = await createAssignment(w, { assigneeIds: [worker.id] });
    const workerApi = as(t, (await loginWorker(t, w.s.orgCode, worker.username!, worker.secret)).accessToken);
    expect(ids((await workerApi.get('/api/v1/assignments')).body.items)).toEqual([mine.id]);
    expect((await workerApi.get(`/api/v1/occurrences?${RANGE}`)).body.items.every((o: { assignmentId: string }) => o.assignmentId === mine.id)).toBe(true);

    const boss = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: lead, fullName: 'Rəhbər', emailVerified: true });
    await w.api.patch(`/api/v1/users/${bWorker}`, { managerId: boss.id });
    const bossApi = as(t, (await loginStaff(t, boss.email!, boss.secret)).accessToken);
    expect(ids((await bossApi.get('/api/v1/assignments')).body.items)).toEqual([atB]);
    const write = await bossApi.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.otherSiteId, assigneeIds: [bWorker], schedule: daily(), timing: fixed() });
    expect(write.body.error.code).toBe('SITE_OUT_OF_SCOPE');
  });

  it('gives platform admins the whole tenant', async () => {
    const email = `${uniq('admin')}@taskop.az`;
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    const token = (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken;
    const p = as(t, token);
    const list = await p.get(`/api/v1/platform/tenants/${w.s.tenantId}/assignments?limit=200`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(ids(list.body.items)).toEqual(expect.arrayContaining([atA, atB]));
  });
});

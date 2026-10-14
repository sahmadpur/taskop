import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimOk, type ExecutionWorld, executionWorld } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

describe('run detail for report viewers (SP7 spec §5.6)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: ExecutionWorld;
  let executionId: string;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
  });
  afterAll(() => t.close());

  const staff = async (role: { roleKey?: 'manager'; roleId?: string }, siteIds: string[] = []) => {
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', emailVerified: true, ...role });
    if (siteIds.length) expect((await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds })).status).toBe(200);
    return { id: u.id, api: as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken) };
  };
  const customRole = async (dataScope: string, permissions: string[]) => {
    const res = await w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope, permissions });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  /** [GET /executions/:id, GET /occurrences/:id] statuses. */
  const reads = async (api: Api) => [(await api.get(`/api/v1/executions/${executionId}`)).status, (await api.get(`/api/v1/occurrences/${w.occurrenceId}`)).status];

  it('lets a site_subtree manager read runs at their site, and only there (already true)', async () => {
    expect(await reads((await staff({ roleKey: 'manager' }, [w.siteId])).api)).toEqual([200, 200]);
    expect(await reads((await staff({ roleKey: 'manager' }, [w.otherSiteId])).api)).toEqual([404, 404]);
  });

  it('lets a subordinates manager read the runs of their people, and only theirs (already true)', async () => {
    const boss = await staff({ roleId: await customRole('subordinates', ['assignments.view', 'reports.view']) });
    expect(await reads(boss.api)).toEqual([404, 404]);
    await ownerQuery('update users set manager_id = $1 where id = $2', [boss.id, w.workers[0].id]);
    expect(await reads(boss.api)).toEqual([200, 200]);
  });

  it('lets a reports.view holder without assignments.view open the run and its execution', async () => {
    const viewer = await staff({ roleId: await customRole('all', ['reports.view']) });
    expect(await reads(viewer.api)).toEqual([200, 200]);
  });

  it('still hides the run from a role with neither key', async () => {
    const other = await staff({ roleId: await customRole('all', ['checklists.view']) });
    expect(await reads(other.api)).toEqual([404, 403]);
  });
});

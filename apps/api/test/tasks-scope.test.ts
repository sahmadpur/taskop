import type { SystemRoleKey } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';
import { act, createTask, newTaskBody, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;
const list = async (api: Api, qs = '') => ((await api.get(`/api/v1/tasks${qs}`)).body.items as Array<{ id: string }>).map((i) => i.id);
const sorted = (xs: string[]) => [...xs].sort();

describe('listing tasks and the read scope', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('filters by status, overdue, site, assignee, team, creator, source, review and due range, newest first with a cursor', async () => {
    const w = await taskWorld(t);
    const w1 = w.workers[0];
    const a = await createTask(w.manager.api, newTaskBody({ userId: w1.id }, { siteId: w.siteId, dueAt: T('06:00') }));
    clock.advanceMinutes(1);
    const b = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }, { dueAt: T('09:00') }));
    clock.advanceMinutes(1);
    const c = await createTask(w.owner, newTaskBody({ userId: w1.id }, { requiresReview: true }));
    await ownerQuery('update tasks set overdue_at = due_at where id = $1', [a.id]);
    await ownerQuery("update tasks set status = 'awaiting_review' where id = $1", [c.id]);
    expect(await list(w.owner)).toEqual([c.id, b.id, a.id]);
    expect(await list(w.owner, '?status=awaiting_review')).toEqual([c.id]);
    expect(await list(w.owner, '?status=new,awaiting_review')).toEqual([c.id, b.id, a.id]);
    expect(await list(w.owner, '?overdue=true')).toEqual([a.id]);
    expect(await list(w.owner, '?overdue=false')).toEqual([c.id, b.id]);
    expect(await list(w.owner, `?siteId=${w.siteId}`)).toEqual([a.id]);
    expect(await list(w.owner, `?assigneeUserId=${w1.id}`)).toEqual([c.id, a.id]);
    expect(await list(w.owner, `?teamId=${w.teamId}`)).toEqual([b.id]);
    expect(await list(w.owner, `?createdBy=${w.manager.id}`)).toEqual([b.id, a.id]);
    expect(await list(w.owner, '?source=adhoc')).toEqual([c.id, b.id, a.id]);
    expect(await list(w.owner, '?source=problem')).toEqual([]);
    expect(await list(w.owner, `?dueFrom=${T('05:00')}&dueTo=${T('07:00')}`)).toEqual([a.id]);
    expect(await list(w.manager.api, '?awaitingMyReview=true')).toEqual([c.id]);
    expect(await list(w1.api, '?awaitingMyReview=true')).toEqual([]);
    const page1 = (await w.owner.get('/api/v1/tasks?limit=2')).body;
    expect(page1.items.map((i: { id: string }) => i.id)).toEqual([c.id, b.id]);
    expect(page1.items[0]).toMatchObject({ id: c.id, status: 'awaiting_review', assignee: { id: w1.id, fullName: 'İşçi 1' }, createdBy: { id: w.s.ownerId }, source: 'adhoc' });
    const page2 = (await w.owner.get(`/api/v1/tasks?limit=2&cursor=${page1.nextCursor}`)).body;
    expect([page2.items.map((i: { id: string }) => i.id), page2.nextCursor]).toEqual([[a.id], null]);
    const bad = await w.owner.get('/api/v1/tasks?status=late');
    expect(bad.status).toBe(400);
  });

  it('applies the read rules of each data scope, and team visibility ends when a teammate accepts', async () => {
    const w = await taskWorld(t);
    const [w1, w2, w3] = w.workers;
    const a = await createTask(w.manager.api, newTaskBody({ userId: w1.id }, { siteId: w.siteId }));
    const b = await createTask(w.owner, newTaskBody({ userId: w3.id }, { siteId: w.otherSiteId }));
    const c = await createTask(w.owner, newTaskBody({ teamId: w.teamId }));
    const d = await createTask(w.owner, newTaskBody({ userId: w3.id }));
    const visible = async (api: Api) => sorted(await list(api, '?limit=200'));
    const staff = async (role: { roleKey?: SystemRoleKey; roleId?: string }) => {
      const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', emailVerified: true, ...role });
      return { id: u.id, api: as(t, (await loginStaff(t, u.email!, u.secret)).accessToken) };
    };
    expect(await visible((await staff({ roleKey: 'auditor' })).api)).toEqual(sorted([a.id, b.id, c.id, d.id]));
    expect(await visible(w.manager.api)).toEqual([a.id]);
    const subordinates = (await w.owner.post('/api/v1/roles', { name: uniq('Rəhbər'), dataScope: 'subordinates', permissions: ['tasks.view'] })).body.id as string;
    const lead = await staff({ roleId: subordinates });
    await ownerQuery('update users set manager_id = $1 where id = $2', [lead.id, w3.id]);
    expect(await visible(lead.api)).toEqual(sorted([b.id, d.id]));
    const ownOnly = (await w.owner.post('/api/v1/roles', { name: uniq('Özü'), dataScope: 'own', permissions: ['tasks.view'] })).body.id as string;
    const own = await staff({ roleId: ownOnly });
    expect(await visible(own.api)).toEqual([]);
    expect((await own.api.get(`/api/v1/tasks/${a.id}`)).status).toBe(404);
    expect(await visible(w1.api)).toEqual(sorted([a.id, c.id]));
    expect(await visible(w2.api)).toEqual([c.id]);
    expect(await visible(w3.api)).toEqual(sorted([b.id, d.id]));
    clock.set(T('04:20'));
    expect((await act(w1.api, c.id, 'accept', T('04:10'))).status).toBe(200);
    expect(await visible(w2.api)).toEqual([]);
    expect((await w2.api.get(`/api/v1/tasks/${c.id}`)).status).toBe(404);
    expect(await visible(w.manager.api)).toEqual(sorted([a.id, c.id]));
  });

  it('hides an unaccepted team task from the members of a deactivated team (R6)', async () => {
    const w = await taskWorld(t);
    const [w1, , w3] = w.workers;
    const team = (await w.owner.post('/api/v1/teams', { name: uniq('Komanda') })).body.id as string;
    expect((await w.owner.put(`/api/v1/teams/${team}/members`, { userIds: [w1.id] })).status).toBe(200);
    const task = await createTask(w.owner, newTaskBody({ teamId: team }));
    expect(await list(w1.api)).toEqual([task.id]);
    expect(await list(w3.api)).toEqual([]);
    await ownerQuery('update teams set active = false where id = $1', [team]);
    expect(await list(w1.api)).toEqual([]);
    expect((await w1.api.get(`/api/v1/tasks/${task.id}`)).status).toBe(404);
  });
});

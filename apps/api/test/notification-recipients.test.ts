import type { NotificationRuleDto, RuleType } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationRecipients } from '../src/notifications/notification-recipients';
import { NotificationTargets, type RuleTarget } from '../src/notifications/notification-targets';
import { NotificationRules } from '../src/notifications/rules.service';
import { ScopeSubjects } from '../src/notifications/scope-subjects';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect, roleIdOf, siteTypeIdOf } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { act, closedRunWithProblems, createTask, newTaskBody, taskWorld } from './task-fixtures';

const sorted = (...ids: string[]) => [...ids].sort();

describe('notification recipients', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** Loads the target and the tenant's effective rule (with `override` laid over it) and resolves the recipients. */
  const resolve = (tenantId: string, type: RuleType, payload: object, actor: string | null = null, override: Partial<NotificationRuleDto> = {}) =>
    t.app.get(DbService).withTenant(tenantId, null, async () => {
      const target = await t.app.get(NotificationTargets).load(type, payload, actor);
      const rule = { ...(await t.app.get(NotificationRules).effective(type)), ...override };
      return t.app.get(NotificationRecipients).resolve(rule, target as RuleTarget, actor);
    });

  const role = async (api: Api, name: string, dataScope: string, permissions: string[]) => {
    const res = await api.post('/api/v1/roles', { name, dataScope, permissions });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  async function checklistWorld() {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const occurrenceId = (await occurrenceRows(a.id))[0]!.id;
    const here = await staffAt(t, w.s.tenantId, w.api, 'manager', [w.siteId], 'Menecer 1');
    const there = await staffAt(t, w.s.tenantId, w.api, 'manager', [w.otherSiteId], 'Menecer 2');
    const admin = await staffAt(t, w.s.tenantId, w.api, 'admin', [], 'Admin');
    return { w, a, occurrenceId, here, there, admin };
  }

  it('sends overdue to the assignees and the managers whose sites cover the run; missed to managers and admins', async () => {
    const { w, occurrenceId, here, admin } = await checklistWorld();
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId })).toEqual(sorted(w.workers[0]!, w.workers[1]!, here.id));
    expect(await resolve(w.s.tenantId, 'checklist.missed', { occurrenceId })).toEqual(sorted(here.id, admin.id));
  });

  it('applies every data scope of a role holder and needs assignments.view', async () => {
    const { w, occurrenceId } = await checklistWorld();
    const rAll = await role(w.api, 'Hamısı', 'all', ['assignments.view']);
    const rSubtree = await role(w.api, 'Obyekt', 'site_subtree', ['assignments.view']);
    const rSubs = await role(w.api, 'Rəhbər', 'subordinates', ['assignments.view']);
    const rOwn = await role(w.api, 'Özü', 'own', ['assignments.view']);
    const rNoView = await role(w.api, 'Baxışsız', 'all', []);
    const user = (roleId: string, fullName: string) => createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId, fullName });
    const all = await user(rAll, 'Hamısı');
    const subtreeHere = await user(rSubtree, 'Obyekt 1');
    expect((await w.api.put(`/api/v1/users/${subtreeHere.id}/sites`, { siteIds: [w.siteId] })).status).toBe(200);
    // Left out: a site_subtree holder elsewhere, a boss without subordinates on the run, an "own" stranger, a role without assignments.view.
    const subtreeThere = await user(rSubtree, 'Obyekt 2');
    expect((await w.api.put(`/api/v1/users/${subtreeThere.id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    const boss = await user(rSubs, 'Rəhbər');
    await ownerQuery('update users set manager_id = $1 where id = $2', [boss.id, w.workers[0]]);
    await user(rSubs, 'Tək rəhbər');
    // An assignee whose own role is "own" sees the run; a stranger with "own" does not.
    await ownerQuery('update users set role_id = $1 where id = $2', [rOwn, w.workers[1]]);
    await user(rOwn, 'Kənar');
    await user(rNoView, 'Baxışsız');
    const roleIds = [rAll, rSubtree, rSubs, rOwn, rNoView];
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId }, null, { notifyAssignees: false, roleIds })).toEqual(
      sorted(all.id, subtreeHere.id, boss.id, w.workers[1]!),
    );
    // An inactive role grants nothing.
    await ownerQuery('update roles set active = false where id = $1', [rAll]);
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId }, null, { notifyAssignees: false, roleIds })).toEqual(
      sorted(subtreeHere.id, boss.id, w.workers[1]!),
    );
  });

  it('removes the actor and inactive users', async () => {
    const { w, occurrenceId, here } = await checklistWorld();
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId }, w.workers[0]!)).toEqual(sorted(w.workers[1]!, here.id));
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w.workers[1]]);
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId })).toEqual(sorted(w.workers[0]!, here.id));
  });

  it('tells the added users about an assignment, and role holders whose scope covers it', async () => {
    const { w, a, here } = await checklistWorld();
    const manager = await roleIdOf(w.s.tenantId, 'manager');
    expect(await resolve(w.s.tenantId, 'checklist.assigned', { assignmentId: a.id, addedUserIds: [w.workers[0]] })).toEqual([w.workers[0]]);
    expect(await resolve(w.s.tenantId, 'checklist.assigned', { assignmentId: a.id, addedUserIds: [w.workers[0]] }, w.s.ownerId, { roleIds: [manager] })).toEqual(
      sorted(w.workers[0]!, here.id),
    );
  });

  it('sends problems to the role holders who can see the run only, and treats a deleted problem as gone', async () => {
    const run = await closedRunWithProblems(t, clock);
    const w = run.w;
    const here = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 1');
    await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.otherSiteId], 'Menecer 2');
    const admin = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    const critical = { problemId: run.manualProblemId, occurrenceId: w.occurrenceId };
    expect(await resolve(w.s.tenantId, 'problem.critical', critical, w.workers[0].id)).toEqual(sorted(here.id, admin.id));
    expect(await resolve(w.s.tenantId, 'problem.recorded', { problemId: run.ruleProblemId, occurrenceId: w.occurrenceId }, w.workers[0].id)).toEqual([here.id]);
    // A later answers sync may delete a problem before its fan-out runs.
    await ownerQuery('delete from execution_problems where id = $1', [run.manualProblemId]);
    const gone = await t.app.get(DbService).withTenant(w.s.tenantId, null, () => t.app.get(NotificationTargets).load('problem.critical', critical, null));
    expect(gone).toBeNull();
  });

  it('sends team tasks to active team members until one accepts, and dedupes an assignee who is also the creator', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    expect(await resolve(w.s.tenantId, 'task.assigned', { taskId: team.id }, w.manager.id)).toEqual(sorted(w1.id, w2.id));
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w2.id]);
    expect(await resolve(w.s.tenantId, 'task.cancelled', { taskId: team.id }, w.manager.id)).toEqual([w1.id]);
    await ownerQuery("update users set status = 'active' where id = $1", [w2.id]);
    clock.set('2026-11-02T04:20:00Z');
    await act(w1.api, team.id, 'accept', '2026-11-02T04:10:00.000Z');
    expect(await resolve(w.s.tenantId, 'task.cancelled', { taskId: team.id }, w.manager.id)).toEqual([w1.id]);
    const own = await createTask(w.manager.api, newTaskBody({ userId: w.manager.id }));
    expect(await resolve(w.s.tenantId, 'task.overdue', { taskId: own.id })).toEqual([w.manager.id]);
    expect(await resolve(w.s.tenantId, 'task.overdue', { taskId: own.id }, w.manager.id)).toEqual([]);
  });

  it('sends task notices to role holders who can read the task (tasks.view or tasks.manage, and TaskScope)', async () => {
    const w = await taskWorld(t);
    // A manager at Filial 2 reads neither the site nor the assignee (İşçi 1 works at Filial 1).
    await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.otherSiteId], 'Menecer 2');
    const task = await createTask(w.owner, newTaskBody({ userId: w.workers[0].id }, { siteId: w.siteId }));
    const manager = await roleIdOf(w.s.tenantId, 'manager');
    const worker = await roleIdOf(w.s.tenantId, 'worker');
    const rule = { notifyCreator: false, roleIds: [manager, worker] };
    expect(await resolve(w.s.tenantId, 'task.completed', { taskId: task.id }, w.workers[0].id, rule)).toEqual([w.manager.id]);
    expect(await resolve(w.s.tenantId, 'task.completed', { taskId: task.id }, w.workers[0].id)).toEqual([w.s.ownerId]);
  });

  it('expands a message to users, active members of active teams and users of a site subtree, inside the sender’s scope', async () => {
    const w = await schedulingWorld(t);
    const typeId = await siteTypeIdOf(w.s.tenantId);
    const child = (await w.api.post('/api/v1/sites', { parentId: w.siteId, typeId, name: 'Filial 1A' })).body.id as string;
    const childWorker = await createUserDirect(t, w.s.tenantId, { fullName: 'İşçi 1A' });
    expect((await w.api.put(`/api/v1/users/${childWorker.id}/sites`, { siteIds: [child] })).status).toBe(200);
    const far = await createUserDirect(t, w.s.tenantId, { fullName: 'Uzaq işçi' });
    expect((await w.api.put(`/api/v1/users/${far.id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    const team = (await w.api.post('/api/v1/teams', { name: 'Növbə A' })).body.id as string;
    expect((await w.api.put(`/api/v1/teams/${team}/members`, { userIds: [w.workers[0], far.id] })).status).toBe(200);
    const sleeping = (await w.api.post('/api/v1/teams', { name: 'Köhnə' })).body.id as string;
    expect((await w.api.put(`/api/v1/teams/${sleeping}/members`, { userIds: [w.workers[1]] })).status).toBe(200);
    expect((await w.api.patch(`/api/v1/teams/${sleeping}`, { active: false })).status).toBe(200);
    const here = await staffAt(t, w.s.tenantId, w.api, 'manager', [w.siteId], 'Menecer 1');
    const expand = (senderId: string, targets: { userIds?: string[]; teamIds?: string[]; siteIds?: string[] }) =>
      t.app.get(DbService).withTenant(w.s.tenantId, null, async () => {
        const sender = (await t.app.get(ScopeSubjects).forUser(senderId))!;
        return t.app.get(NotificationRecipients).expandMessage(sender, { userIds: [], teamIds: [], siteIds: [], ...targets });
      });
    expect(await expand(here.id, { siteIds: [w.siteId] })).toEqual(sorted(w.workers[0]!, w.workers[1]!, childWorker.id));
    expect(await expand(here.id, { siteIds: [child] })).toEqual([childWorker.id]);
    expect(await expand(here.id, { teamIds: [team] })).toEqual([w.workers[0]]);
    expect(await expand(here.id, { teamIds: [sleeping] })).toEqual([]);
    expect(await expand(here.id, { userIds: [far.id, here.id] })).toEqual([]);
    expect(await expand(w.s.ownerId, { teamIds: [team], userIds: [here.id] })).toEqual(sorted(w.workers[0]!, far.id, here.id));
    await ownerQuery("update users set status = 'deactivated' where id = $1", [childWorker.id]);
    expect(await expand(here.id, { siteIds: [w.siteId] })).toEqual(sorted(w.workers[0]!, w.workers[1]!));
  });
});

import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';
import { auditActions, captureTaskEvents, createTask, newTaskBody, taskHistory, taskWorld } from './task-fixtures';

describe('creating and reading tasks', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('creates a task for a person in scope with history, audit and a task.assigned event', async () => {
    const w = await taskWorld(t);
    const events = captureTaskEvents(t);
    const body = newTaskBody({ userId: w.workers[0].id }, { siteId: w.siteId, dueAt: '2026-11-03T14:00:00.000Z', priority: 'high' });
    const task = await createTask(w.manager.api, body);
    events.stop();
    expect(task).toMatchObject({
      id: body.id,
      title: 'Soyuducunun qapısını təmir edin',
      instructions: 'Qapının rezinini dəyişin.',
      priority: 'high',
      status: 'new',
      site: { id: w.siteId, name: 'Filial 1' },
      assignee: { id: w.workers[0].id, fullName: 'İşçi 1' },
      team: null,
      assigneeInactive: false,
      createdBy: { id: w.manager.id, fullName: 'Menecer' },
      requiresReview: false,
      source: 'adhoc',
      problemId: null,
      problem: null,
      evidence: { photo: 'optional', video: 'optional', liveOnly: false },
      dueAt: '2026-11-03T14:00:00.000Z',
      overdueAt: null,
      acceptedAt: null,
      rev: 1,
      createdAt: '2026-11-02T04:00:00.000Z',
      media: [],
      submissions: [],
      canManage: true,
      canReview: true,
    });
    expect(task.history).toEqual([
      { id: expect.any(String), fromStatus: null, toStatus: 'new', at: '2026-11-02T04:00:00.000Z', actor: { id: w.manager.id, fullName: 'Menecer' }, comment: null },
    ]);
    expect(await auditActions(task.id)).toEqual(['task.created']);
    expect(events.seen).toEqual([['task.assigned', task.id, w.manager.id]]);
  });

  it('returns the stored task when the same id is sent again', async () => {
    const w = await taskWorld(t);
    const body = newTaskBody({ teamId: w.teamId });
    const first = await createTask(w.manager.api, body);
    expect(first).toMatchObject({ assignee: null, team: { id: w.teamId, name: 'Texniki xidmət' } });
    clock.advanceMinutes(5);
    const again = await createTask(w.manager.api, { ...body, title: 'Başqa ad' });
    expect(again).toMatchObject({ id: first.id, title: first.title, createdAt: first.createdAt, rev: 1 });
    expect(await taskHistory(first.id)).toHaveLength(1);
    expect(await auditActions(first.id)).toEqual(['task.created']);
  });

  it('assigns only active people within the creator’s scope, and active teams with an active member', async () => {
    const w = await taskWorld(t);
    const refused = async (api: Api, assignee: { userId: string } | { teamId: string }) => {
      const res = await api.post('/api/v1/tasks', newTaskBody(assignee));
      expect([res.status, res.body.error?.code, res.body.error?.fields], JSON.stringify(res.body)).toEqual([422, 'TASK_ASSIGNEE_INVALID', { assignee: 'errors.TASK_ASSIGNEE_INVALID' }]);
    };
    await refused(w.manager.api, { userId: w.workers[2].id });
    await createTask(w.owner, newTaskBody({ userId: w.workers[2].id }));
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    expect((await w.owner.post(`/api/v1/users/${w.workers[1].id}/deactivate`)).status).toBe(200);
    await refused(w.owner, { userId: w.workers[1].id });
    await refused(w.owner, { userId: uuidv7() });
    const empty = (await w.owner.post('/api/v1/teams', { name: 'Boş komanda' })).body.id as string;
    await refused(w.owner, { teamId: empty });
    await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    expect((await w.owner.patch(`/api/v1/teams/${w.teamId}`, { active: false })).status).toBe(200);
    await refused(w.owner, { teamId: w.teamId });
  });

  it('validates the body and the site', async () => {
    const w = await taskWorld(t);
    const assignee = { userId: w.workers[0].id };
    const both = await w.owner.post('/api/v1/tasks', newTaskBody({ userId: w.workers[0].id, teamId: w.teamId } as unknown as { userId: string }));
    expect([both.status, both.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
    const long = await w.owner.post('/api/v1/tasks', newTaskBody(assignee, { title: 'x'.repeat(201) }));
    expect([long.status, long.body.error.fields]).toEqual([400, { title: 'errors.validation.tooLong' }]);
    const outside = await w.manager.api.post('/api/v1/tasks', newTaskBody(assignee, { siteId: w.otherSiteId }));
    expect([outside.status, outside.body.error.code]).toEqual([403, 'SITE_OUT_OF_SCOPE']);
    expect((await w.owner.patch(`/api/v1/sites/${w.otherSiteId}`, { active: false })).status).toBe(200);
    const inactive = await w.owner.post('/api/v1/tasks', newTaskBody(assignee, { siteId: w.otherSiteId }));
    expect([inactive.status, inactive.body.error.code]).toEqual([409, 'SITE_INACTIVE']);
    const missing = await w.owner.post('/api/v1/tasks', newTaskBody(assignee, { siteId: uuidv7() }));
    expect([missing.status, missing.body.error.code]).toEqual([422, 'REFERENCE_NOT_FOUND']);
  });

  it('lets only tasks.manage holders create tasks and list assignees', async () => {
    const w = await taskWorld(t);
    expect((await w.workers[0].api.post('/api/v1/tasks', newTaskBody({ userId: w.workers[0].id }))).status).toBe(403);
    expect((await w.workers[0].api.get('/api/v1/tasks/assignees')).status).toBe(403);
  });

  it('lists people in the caller’s scope and active teams with members, filtered by name', async () => {
    const w = await taskWorld(t);
    const res = await w.manager.api.get('/api/v1/tasks/assignees');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.users.map((u: { fullName: string }) => u.fullName).sort()).toEqual(['Menecer', 'İşçi 1', 'İşçi 2']);
    expect(res.body.users.find((u: { id: string }) => u.id === w.workers[0].id)).toEqual({ id: w.workers[0].id, fullName: 'İşçi 1', jobTitle: null, kind: 'worker' });
    expect(res.body.teams).toEqual([{ id: w.teamId, name: 'Texniki xidmət', memberCount: 2 }]);
    const two = await w.manager.api.get('/api/v1/tasks/assignees?q=2');
    expect([two.body.users.map((u: { fullName: string }) => u.fullName), two.body.teams]).toEqual([['İşçi 2'], []]);
  });

  it('offers the active sites a task may name, without sites.view and whatever the search', async () => {
    const w = await taskWorld(t);
    const names = (sites: Array<{ name: string }>) => sites.map((s) => s.name);
    // The site_subtree manager (no sites.view needed): Filial 1 only; the search narrows people, never sites.
    const mine = await w.manager.api.get('/api/v1/tasks/assignees?q=zzz');
    expect([mine.body.users, mine.body.teams, mine.body.sites]).toEqual([[], [], [{ id: w.siteId, name: 'Filial 1' }]]);
    // The owner (all): every active site, by name.
    expect(names((await w.owner.get('/api/v1/tasks/assignees')).body.sites)).toEqual(expect.arrayContaining(['Filial 1', 'Filial 2']));
    expect((await w.owner.patch(`/api/v1/sites/${w.otherSiteId}`, { active: false })).status).toBe(200);
    expect(names((await w.owner.get('/api/v1/tasks/assignees')).body.sites)).not.toContain('Filial 2');
    // Every offered site is one the create accepts.
    for (const site of mine.body.sites as Array<{ id: string }>) {
      const res = await w.manager.api.post('/api/v1/tasks', newTaskBody({ userId: w.workers[0].id }, { siteId: site.id }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  });

  it('lets the creator, the assignee and members of an unaccepted team task read it, and nobody else', async () => {
    const w = await taskWorld(t);
    const direct = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    const status = async (api: Api, id: string) => (await api.get(`/api/v1/tasks/${id}`)).status;
    expect(await status(w.workers[0].api, direct.id)).toBe(200);
    expect(await status(w.workers[1].api, direct.id)).toBe(404);
    expect(await status(w.workers[1].api, team.id)).toBe(200);
    expect(await status(w.workers[2].api, team.id)).toBe(404);
    expect(await status(w.owner, uuidv7())).toBe(404);
    const asWorker = (await w.workers[0].api.get(`/api/v1/tasks/${direct.id}`)).body;
    expect([asWorker.canManage, asWorker.canReview]).toEqual([false, false]);
  });

  it('stops showing an unaccepted team task to the members once the team is deactivated', async () => {
    const w = await taskWorld(t);
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    expect((await w.workers[1].api.get(`/api/v1/tasks/${team.id}`)).status).toBe(200);
    expect((await w.owner.patch(`/api/v1/teams/${w.teamId}`, { active: false })).status).toBe(200);
    expect((await w.workers[1].api.get(`/api/v1/tasks/${team.id}`)).status).toBe(404);
    expect((await w.manager.api.get(`/api/v1/tasks/${team.id}`)).status).toBe(200);
  });

  it('limits a subordinates-scope creator to people in their reporting chain, and an own-scope creator to themself', async () => {
    const w = await taskWorld(t);
    const staffWith = async (dataScope: 'subordinates' | 'own', fullName: string, managerOf: string[] = []) => {
      const role = await w.owner.post('/api/v1/roles', { name: uniq('Tapşırıq'), dataScope, permissions: ['tasks.manage'] });
      expect(role.status, JSON.stringify(role.body)).toBe(201);
      const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: role.body.id as string, fullName, emailVerified: true });
      for (const id of managerOf) await ownerQuery('update users set manager_id = $1 where id = $2', [u.id, id]);
      return { id: u.id, api: as(t, (await loginStaff(t, u.email!, u.secret)).accessToken) };
    };
    const refused = async (api: Api, userId: string) => {
      const res = await api.post('/api/v1/tasks', newTaskBody({ userId }));
      expect([res.status, res.body.error?.code], JSON.stringify(res.body)).toEqual([422, 'TASK_ASSIGNEE_INVALID']);
    };
    const lead = await staffWith('subordinates', 'Rəhbər', [w.workers[0].id]);
    await createTask(lead.api, newTaskBody({ userId: w.workers[0].id }));
    await createTask(lead.api, newTaskBody({ userId: lead.id }));
    await refused(lead.api, w.workers[1].id);
    await refused(lead.api, w.manager.id);
    expect((await lead.api.get('/api/v1/tasks/assignees')).body.users.map((u: { fullName: string }) => u.fullName).sort()).toEqual(['Rəhbər', 'İşçi 1']);

    const solo = await staffWith('own', 'Tək');
    await createTask(solo.api, newTaskBody({ userId: solo.id }));
    await refused(solo.api, w.workers[0].id);
    expect((await solo.api.get('/api/v1/tasks/assignees')).body.users.map((u: { fullName: string }) => u.fullName)).toEqual(['Tək']);
  });
});

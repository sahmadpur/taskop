import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { act, auditActions, captureTaskEvents, createTask, newTaskBody, taskHistory, taskRow, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

describe('accepting and starting tasks', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('accepts a direct task at the device time, with history and the task.accepted event; a repeat is a no-op', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    clock.set(T('04:20'));
    const events = captureTaskEvents(t);
    const res = await act(w.workers[0].api, task.id, 'accept', T('04:10'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', acceptedAt: T('04:10'), startedAt: null, rev: 2, assignee: { id: w.workers[0].id } });
    const again = await act(w.workers[0].api, task.id, 'accept', T('04:11'));
    expect([again.status, again.body.acceptedAt, again.body.rev]).toEqual([200, T('04:10'), 2]);
    events.stop();
    expect(events.seen).toEqual([['task.accepted', task.id, w.workers[0].id]]);
    expect(await taskHistory(task.id)).toEqual([
      [null, 'new', w.manager.id, null],
      ['new', 'accepted', w.workers[0].id, null],
    ]);
    expect(await auditActions(task.id)).toEqual(['task.created']);
  });

  it('start on a new task accepts and starts it in one step; repeating start or accept afterwards is a no-op', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    clock.set(T('04:20'));
    const res = await act(w.workers[0].api, task.id, 'start', T('04:12'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'in_progress', acceptedAt: T('04:12'), startedAt: T('04:12'), rev: 3 });
    expect(await taskHistory(task.id)).toEqual([
      [null, 'new', w.manager.id, null],
      ['new', 'accepted', w.workers[0].id, null],
      ['accepted', 'in_progress', w.workers[0].id, null],
    ]);
    expect((await act(w.workers[0].api, task.id, 'accept', T('04:13'))).body).toMatchObject({ status: 'in_progress', rev: 3 });
    expect((await act(w.workers[0].api, task.id, 'start', T('04:14'))).body).toMatchObject({ status: 'in_progress', startedAt: T('04:12'), rev: 3 });
  });

  // Clients send device time − their last measured clock offset (Interfaces → Server behaviour), so `at` is already on
  // the server's clock here: the server adds no offset and only bounds it.
  it('raises device times before the previous step and refuses times over 2 minutes ahead', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    clock.set(T('04:20'));
    expect((await act(w.workers[0].api, task.id, 'accept', T('03:00'))).body.acceptedAt).toBe(T('04:00'));
    const ahead = await act(w.workers[0].api, task.id, 'start', '2026-11-02T04:22:00.001Z');
    expect([ahead.status, ahead.body.error.code]).toEqual([422, 'CLOCK_INVALID']);
    expect((await act(w.workers[0].api, task.id, 'start', T('04:22'))).body).toMatchObject({ status: 'in_progress', startedAt: T('04:22') });
  });

  it('gives a team task to the first accept; a teammate’s later accept or start gets TASK_ALREADY_TAKEN', async () => {
    const w = await taskWorld(t);
    const [w1, w2, w3] = w.workers;
    const task = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    clock.set(T('04:20'));
    const won = await act(w2.api, task.id, 'accept', T('04:15'));
    expect(won.status, JSON.stringify(won.body)).toBe(200);
    expect(won.body).toMatchObject({ assignee: { id: w2.id }, team: { id: w.teamId } });
    for (const action of ['accept', 'start'] as const) {
      const lost = await act(w1.api, task.id, action, T('04:16'));
      expect([lost.status, lost.body.error.code], action).toEqual([409, 'TASK_ALREADY_TAKEN']);
    }
    expect((await w1.api.get(`/api/v1/tasks/${task.id}`)).status).toBe(404);
    expect((await act(w3.api, task.id, 'accept', T('04:16'))).status).toBe(404);
    const owner = await act(w.owner, task.id, 'accept', T('04:16'));
    expect([owner.status, owner.body.error.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('lets exactly one of two concurrent accepts win', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    clock.set(T('04:20'));
    const [a, b] = await Promise.all([act(w.workers[0].api, task.id, 'accept', T('04:19')), act(w.workers[1].api, task.id, 'accept', T('04:19'))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? w.workers[0].id : w.workers[1].id;
    expect((await taskRow(task.id)).assignee_user_id).toBe(winner);
    expect((await taskHistory(task.id)).filter(([, to]) => to === 'accepted')).toHaveLength(1);
  });

  it('refuses accept and start once the task is cancelled', async () => {
    const w = await taskWorld(t);
    const direct = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    clock.set(T('04:20'));
    await act(w.workers[0].api, direct.id, 'accept', T('04:10'));
    await ownerQuery("update tasks set status = 'cancelled' where id = any($1)", [[direct.id, team.id]]);
    for (const [id, action] of [[direct.id, 'accept'], [direct.id, 'start'], [team.id, 'accept'], [team.id, 'start']] as const) {
      const res = await act(w.workers[0].api, id, action, T('04:15'));
      expect([res.status, res.body.error.code], action).toEqual([409, 'TASK_STATE_INVALID']);
    }
  });
});

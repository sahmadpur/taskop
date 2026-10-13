import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';
import { act, createTask, newTaskBody, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;
const pull = (api: Api, known: string[] = []) => api.get(`/api/v1/me/sync${known.length ? `?knownTaskIds=${known.join(',')}` : ''}`);
const taskIds = (body: { tasks: Array<{ id: string }> }) => body.tasks.map((x) => x.id);

describe('tasks in the download sync', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('adds the caller’s open tasks and their teams’ unaccepted tasks, oldest first, without history or rights', async () => {
    const w = await taskWorld(t);
    const [w1, w2, w3] = w.workers;
    const mine = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    clock.advanceMinutes(1);
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    const theirs = await createTask(w.manager.api, newTaskBody({ userId: w2.id }));
    const res = await pull(w1.api);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(taskIds(res.body)).toEqual([mine.id, team.id]);
    expect(res.body.removedTaskIds).toEqual([]);
    expect(res.body.tasks[0]).toMatchObject({ id: mine.id, status: 'new', assignee: { id: w1.id }, instructions: 'Qapının rezinini dəyişin.', media: [], submissions: [], problem: null });
    expect(res.body.tasks[0]).not.toHaveProperty('history');
    expect(res.body.tasks[0]).not.toHaveProperty('canManage');
    expect(taskIds((await pull(w2.api)).body)).toEqual([team.id, theirs.id]);
    expect(taskIds((await pull(w3.api)).body)).toEqual([]);
  });

  it('drops the unaccepted tasks of a deactivated team', async () => {
    const w = await taskWorld(t);
    const [w1] = w.workers;
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    expect(taskIds((await pull(w1.api, [team.id])).body)).toEqual([team.id]);
    expect((await w.owner.patch(`/api/v1/teams/${w.teamId}`, { active: false })).status).toBe(200);
    const res = await pull(w1.api, [team.id]);
    expect([taskIds(res.body), res.body.removedTaskIds]).toEqual([[], [team.id]]);
  });

  it('keeps closed tasks for 7 days and lists tasks that left the set in removedTaskIds', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const done = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    const moved = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    clock.set(T('04:20'));
    await act(w1.api, done.id, 'start', T('04:10'));
    expect((await w1.api.post(`/api/v1/tasks/${done.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') })).body.status).toBe('completed');
    await act(w2.api, team.id, 'accept', T('04:16'));
    await w.manager.api.patch(`/api/v1/tasks/${moved.id}`, { assignee: { userId: w2.id } });
    const known = [done.id, team.id, moved.id];
    const now = await pull(w1.api, known);
    expect(taskIds(now.body)).toEqual([done.id]);
    expect(now.body.tasks[0]).toMatchObject({ status: 'completed', completedAt: T('04:15') });
    expect(now.body.removedTaskIds).toEqual([team.id, moved.id]);
    // Closed at 08:20 Baku on Monday: kept until the same time a week later.
    clock.set('2026-11-09T04:19:59Z');
    expect(taskIds((await pull(w1.api)).body)).toEqual([done.id]);
    clock.set('2026-11-09T04:20:01Z');
    const week = await pull(w1.api, known);
    expect([taskIds(week.body), week.body.removedTaskIds]).toEqual([[], known]);
  });

  it('reads the first 100 known task ids and drops the rest instead of failing the pull', async () => {
    const w = await taskWorld(t);
    const ids = (n: number) => Array.from({ length: n }, () => uuidv7());
    expect((await pull(w.workers[0].api, ids(100))).status).toBe(200);
    const over = ids(101);
    const res = await pull(w.workers[0].api, over);
    expect([res.status, res.body.removedTaskIds]).toEqual([200, over.slice(0, 100)]);
  });
});

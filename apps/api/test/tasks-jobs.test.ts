import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { TaskJobs } from '../src/tasks/task-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { act, captureTaskEvents, createTask, newTaskBody, taskRow, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

describe('tasks.sweep', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: TaskJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(TaskJobs);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('flags open tasks once due (at due_at exactly), emits task.overdue, and never touches final tasks', async () => {
    const w = await taskWorld(t);
    const body = (dueAt: string | null) => newTaskBody({ userId: w.workers[0].id }, { dueAt });
    const due = await createTask(w.manager.api, body(T('05:00')));
    const done = await createTask(w.manager.api, body(T('05:00')));
    const gone = await createTask(w.manager.api, body(T('05:00')));
    const later = await createTask(w.manager.api, body(T('06:00')));
    const never = await createTask(w.manager.api, body(null));
    await ownerQuery("update tasks set status = 'completed' where id = $1", [done.id]);
    expect((await w.manager.api.post(`/api/v1/tasks/${gone.id}/cancel`, { reason: 'Lazım deyil' })).status).toBe(200);
    clock.set('2026-11-02T04:59:59.999Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    clock.set(T('05:00'));
    const events = captureTaskEvents(t);
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    events.stop();
    expect(events.seen).toEqual([['task.overdue', due.id, null]]);
    expect(await taskRow(due.id)).toMatchObject({ overdue_at: new Date(T('05:00')), rev: 2, status: 'new' });
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    for (const id of [done.id, gone.id, later.id, never.id]) expect((await taskRow(id)).overdue_at, id).toBeNull();
    clock.set(T('06:30'));
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect((await w.manager.api.get(`/api/v1/tasks/${later.id}`)).body.overdueAt).toBe(T('06:30'));
  });

  it('keeps the flag when a late task is completed, and does not re-flag a task whose due date moved later', async () => {
    const w = await taskWorld(t);
    const late = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { dueAt: T('05:00') }));
    const moved = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { dueAt: T('05:00') }));
    clock.set(T('05:00'));
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(2);
    clock.set(T('05:10'));
    await act(w.workers[0].api, late.id, 'start', T('05:05'));
    const done = await w.workers[0].api.post(`/api/v1/tasks/${late.id}/submissions`, { id: uuidv7(), submittedAt: T('05:10') });
    expect(done.body).toMatchObject({ status: 'completed', overdueAt: T('05:00') });
    expect((await w.manager.api.patch(`/api/v1/tasks/${moved.id}`, { dueAt: T('07:00') })).body.overdueAt).toBeNull();
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    clock.set(T('07:00'));
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect((await taskRow(moved.id)).overdue_at).toEqual(new Date(T('07:00')));
  });

  it('skips a task locked by a running command and flags it on the next run', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { dueAt: T('05:00') }));
    clock.set(T('05:00'));
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query('select id from tasks where id = $1 for update', [task.id]);
      expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
      await client.query('rollback');
    } finally {
      await client.end();
    }
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
  });
});

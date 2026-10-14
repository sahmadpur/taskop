import { Logger } from '@nestjs/common';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationEvents } from '../src/notifications/notification-events';
import { failureText } from '../src/notifications/queues';
import { JobsService } from '../src/scheduling/jobs.service';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { eventRows } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { act, closedRunWithProblems, createTask, newTaskBody, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

describe('notification outbox', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  it('records task events in the task’s transaction with the actor and the clock’s time, and queues fan-out after commit', async () => {
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const [assigned] = await eventRows(w.s.tenantId);
    expect(assigned).toMatchObject({
      type: 'task.assigned', payload: { taskId: task.id }, actor_user_id: w.manager.id, dedupe_key: null,
      processed_at: null, outcome: null, attempts: 0, created_at: new Date(MONDAY_0800),
    });
    expect(send).toHaveBeenCalledWith('notifications.fanout', { tenantId: w.s.tenantId, eventId: assigned!.id });
    clock.set(T('04:20'));
    await act(w.workers[0].api, task.id, 'start', T('04:10'));
    const done = await w.workers[0].api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') });
    expect(done.body.status).toBe('completed');
    // No review: task.submitted is not notified (Spec decision 23); task.accepted never is.
    expect((await eventRows(w.s.tenantId)).map((r) => [r.type, r.actor_user_id])).toEqual([
      ['task.assigned', w.manager.id],
      ['task.completed', w.workers[0].id],
    ]);
  });

  it('records task.submitted when the task waits for review, then rejection and cancellation', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { requiresReview: true }));
    clock.set(T('04:20'));
    await act(w.workers[0].api, task.id, 'start', T('04:10'));
    expect((await w.workers[0].api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') })).body.status).toBe('awaiting_review');
    expect((await w.manager.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'reject', comment: 'Foto yoxdur' })).status).toBe(200);
    expect((await w.manager.api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: 'Lazım deyil' })).status).toBe(200);
    expect((await eventRows(w.s.tenantId)).map((r) => r.type)).toEqual(['task.assigned', 'task.submitted', 'task.rejected', 'task.cancelled']);
  });

  it('keeps the business change when recording fails', async () => {
    const w = await taskWorld(t);
    const constraint = `test_fail_${w.s.tenantId.replace(/-/g, '')}`;
    // Fails every insert for this tenant only; NOT VALID leaves existing rows alone. Other test files keep working.
    await ownerQuery(`alter table notification_events add constraint ${constraint} check (tenant_id <> '${w.s.tenantId}') not valid`);
    try {
      const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
      expect((await ownerQuery('select 1 from tasks where id = $1', [task.id])).rowCount).toBe(1);
      expect((await ownerQuery('select 1 from task_status_history where task_id = $1', [task.id])).rowCount).toBe(1);
    } finally {
      await ownerQuery(`alter table notification_events drop constraint ${constraint}`);
    }
    expect(await eventRows(w.s.tenantId)).toEqual([]);
  });

  it('drops the event and the fan-out when the business transaction rolls back', async () => {
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const w = await taskWorld(t);
    send.mockClear();
    const db = t.app.get(DbService);
    const events = t.app.get(NotificationEvents);
    await expect(
      db.withTenant(w.s.tenantId, null, async () => {
        await events.record('task.overdue', { taskId: uuidv7() }, null);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await eventRows(w.s.tenantId, 'task.overdue')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('dedupes on the key: a second record is a no-op, create returns null', async () => {
    const w = await taskWorld(t);
    const db = t.app.get(DbService);
    const events = t.app.get(NotificationEvents);
    const occurrenceId = uuidv7();
    const key = `checklist.overdue:${occurrenceId}`;
    const first = await db.withTenant(w.s.tenantId, null, () => events.create('checklist.overdue', { occurrenceId }, null, key));
    expect(await db.withTenant(w.s.tenantId, null, () => events.record('checklist.overdue', { occurrenceId }, null, key))).toBe(false);
    expect(await db.withTenant(w.s.tenantId, null, () => events.create('checklist.overdue', { occurrenceId }, null, key))).toBeNull();
    expect((await eventRows(w.s.tenantId, 'checklist.overdue')).map((r) => r.id)).toEqual([first]);
  });

  it('records overdue and missed once each when a sweep jumps from pending to missed', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const today = (await occurrenceRows(a.id))[0]!;
    clock.set('2026-11-02T07:30:00Z');
    const jobs = t.app.get(OccurrenceJobs);
    await jobs.sweepAll([w.s.tenantId]);
    await jobs.sweepAll([w.s.tenantId]);
    const rows = await eventRows(w.s.tenantId);
    expect(rows.filter((r) => r.type.startsWith('checklist.') && r.type !== 'checklist.assigned').map((r) => [r.type, r.dedupe_key, r.actor_user_id, r.payload])).toEqual([
      ['checklist.overdue', `checklist.overdue:${today.id}`, null, { occurrenceId: today.id }],
      ['checklist.missed', `checklist.missed:${today.id}`, null, { occurrenceId: today.id }],
    ]);
  });

  it('records checklist.assigned with the added users, and problems by severity with their dedupe key', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const [assigned] = await eventRows(w.s.tenantId, 'checklist.assigned');
    expect(assigned).toMatchObject({ actor_user_id: w.s.ownerId, dedupe_key: null, payload: { assignmentId: a.id } });
    expect([...(assigned!.payload.addedUserIds as string[])].sort()).toEqual([...w.workers].sort());

    const run = await closedRunWithProblems(t, clock);
    const problems = (await eventRows(run.w.s.tenantId)).filter((r) => r.type.startsWith('problem.'));
    expect(problems.map((r) => [r.type, r.dedupe_key, r.actor_user_id, r.payload]).sort()).toEqual(
      [
        ['problem.critical', `problem:${run.manualProblemId}`, run.w.workers[0].id, { problemId: run.manualProblemId, occurrenceId: run.w.occurrenceId }],
        ['problem.recorded', `problem:${run.ruleProblemId}`, run.w.workers[0].id, { problemId: run.ruleProblemId, occurrenceId: run.w.occurrenceId }],
      ].sort(),
    );
  });

  it('record reports whether it inserted, and queues fan-out only for inserted rows', async () => {
    const w = await taskWorld(t);
    const db = t.app.get(DbService);
    const events = t.app.get(NotificationEvents);
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const taskId = uuidv7();
    const key = `task.overdue:${taskId}`;
    const results = await db.withTenant(w.s.tenantId, null, async () => [
      await events.record('task.overdue', { taskId }, null, key),
      await events.record('task.overdue', { taskId }, null, key),
    ]);
    expect(results).toEqual([true, false]);
    const rows = await eventRows(w.s.tenantId, 'task.overdue');
    expect(rows).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('notifications.fanout', { tenantId: w.s.tenantId, eventId: rows[0]!.id });
  });

  it('record returns false when the insert fails, and the surrounding transaction still commits', async () => {
    const w = await taskWorld(t);
    const db = t.app.get(DbService);
    const events = t.app.get(NotificationEvents);
    const constraint = `test_fail_${w.s.tenantId.replace(/-/g, '')}`;
    await ownerQuery(`alter table notification_events add constraint ${constraint} check (tenant_id <> '${w.s.tenantId}') not valid`);
    try {
      const recorded = await db.withTenant(w.s.tenantId, null, () => events.record('task.overdue', { taskId: uuidv7() }, null));
      expect(recorded).toBe(false);
    } finally {
      await ownerQuery(`alter table notification_events drop constraint ${constraint}`);
    }
  });

  it('keeps the business change when queueing the fan-out job fails', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const send = vi.spyOn(t.app.get(JobsService), 'send').mockRejectedValue(new Error('jobs failed to start'));
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.waitFor(() => expect(error.mock.calls.some((c) => String(c[1]).includes('Queueing fan-out'))).toBe(true));
    expect((await ownerQuery('select 1 from tasks where id = $1', [task.id])).rowCount).toBe(1);
    expect((await eventRows(w.s.tenantId)).map((r) => r.type)).toEqual(['task.assigned']);
  });

  it('keeps the business change when a listener throws', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(NotificationEvents.prototype, 'record').mockRejectedValue(new Error('listener step failed'));
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    expect((await ownerQuery('select 1 from tasks where id = $1', [task.id])).rowCount).toBe(1);
    expect(await eventRows(w.s.tenantId)).toEqual([]);
    expect(error.mock.calls.some((c) => String(c[1]).includes('Notification listener for task.assigned failed'))).toBe(true);
  });

  it('keeps the submission when the listener’s status read fails', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { requiresReview: true }));
    clock.set(T('04:20'));
    await act(w.workers[0].api, task.id, 'start', T('04:10'));
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // Only reads made through a savepoint (the listener's) fail; the business code's own reads are untouched.
    const db = t.app.get(DbService);
    const realTx = db.tx.bind(db);
    vi.spyOn(db, 'tx').mockImplementation(() => {
      const tx = realTx();
      return new Proxy(tx, {
        get(target, key) {
          if (key !== 'transaction') {
            const v = Reflect.get(target, key, target);
            return typeof v === 'function' ? v.bind(target) : v;
          }
          return (fn: (sp: unknown) => Promise<unknown>) =>
            target.transaction((sp) => fn(new Proxy(sp, { get: (o, k) => (k === 'select' ? () => { throw new Error('status read failed'); } : Reflect.get(o, k, o)) })));
        },
      });
    });
    const res = await w.workers[0].api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') });
    vi.restoreAllMocks();
    expect(res.body.status).toBe('awaiting_review');
    expect((await ownerQuery<{ status: string }>('select status from tasks where id = $1', [task.id])).rows[0]!.status).toBe('awaiting_review');
    expect((await eventRows(w.s.tenantId)).map((r) => r.type)).toEqual(['task.assigned']);
    expect(error.mock.calls.some((c) => String(c[1]).includes('Notification listener for task.submitted failed'))).toBe(true);
  });
});

describe('failureText', () => {
  const sqlText = 'insert into "notification_events" ("id", "payload") values ($1, $2)';

  function pgError(fields: { code: string; constraint?: string }): pg.DatabaseError {
    const e = new pg.DatabaseError('duplicate key value violates unique constraint', 10, 'error');
    return Object.assign(e, { severity: 'ERROR', routine: '_bt_check_unique', ...fields });
  }

  it('reports a Postgres error by SQLSTATE and constraint, never its message', () => {
    expect(failureText(pgError({ code: '23505', constraint: 'notification_events_dedupe_uq' }))).toBe('Database error 23505 (notification_events_dedupe_uq)');
    expect(failureText(pgError({ code: '57014' }))).toBe('Database error 57014');
  });

  it('finds the Postgres error behind a Drizzle wrapper, which carries the SQL', () => {
    const wrapped = new Error(`Failed query: ${sqlText}\nparams: secret-token`, { cause: pgError({ code: '40001' }) });
    expect(failureText(wrapped)).toBe('Database error 40001');
    expect(failureText(new Error(`Failed query: ${sqlText}`))).toBe('Database error');
  });

  it('recognises a pg-shaped object that is not a DatabaseError instance', () => {
    expect(failureText({ code: '23503', severity: 'ERROR', routine: 'ri_ReportViolation', constraint: 'fk' })).toBe('Database error 23503 (fk)');
  });

  it('keeps the message of Node, system and SMTP errors even when their code has five characters', () => {
    for (const [code, message] of [['EAUTH', 'Invalid login: 535 authentication failed'], ['EPIPE', 'write EPIPE'], ['ECONNRESET', 'read ECONNRESET'], ['ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.1:587']] as const) {
      expect(failureText(Object.assign(new Error(message), { code }))).toBe(message);
    }
    expect(failureText(Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }))).toBe('Greeting never received');
  });

  it('truncates long messages to 500 characters and accepts non-errors', () => {
    expect(failureText(new Error('x'.repeat(2000)))).toHaveLength(500);
    expect(failureText('plain string')).toBe('plain string');
  });
});

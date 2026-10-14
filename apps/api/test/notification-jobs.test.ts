import { Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationFanout } from '../src/notifications/notification-fanout';
import { NotificationJobs } from '../src/notifications/notification-jobs';
import { JobsService } from '../src/scheduling/jobs.service';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addDevice, deliverAll, deliveriesOf, eventRows, fanOutAll, inboxOf, pushSender } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { createTask, newTaskBody, taskWorld } from './task-fixtures';

describe('notification crons', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: NotificationJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(NotificationJobs);
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    pushSender(t).reset();
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** İşçi 1 with two phones gets a task; both pushes are sent at 04:00. */
  async function sentPushes() {
    const w = await taskWorld(t);
    const phones = [await addDevice(w.s.tenantId, w.workers[0].id), await addDevice(w.s.tenantId, w.workers[0].id)];
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    return { w, phones };
  }

  it('reads receipts 15 minutes after sending: ok → delivered, DeviceNotRegistered → failed and the device disabled', async () => {
    const { w, phones } = await sentPushes();
    const [first, second] = await deliveriesOf(w.workers[0].id);
    pushSender(t).receiptFor = (id) =>
      id === second!.provider_ref ? { ok: false, error: 'DeviceNotRegistered', message: 'gone' } : { ok: true };
    clock.set('2026-11-02T04:14:59Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(0);
    clock.set('2026-11-02T04:15:00Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(2);
    expect((await deliveriesOf(w.workers[0].id)).map((d) => [d.id, d.status, d.last_error])).toEqual([
      [first!.id, 'delivered', null],
      [second!.id, 'failed', 'DeviceNotRegistered: gone'],
    ]);
    const disabled = await ownerQuery<{ id: string }>('select id from push_devices where user_id = $1 and disabled_at is not null', [w.workers[0].id]);
    expect(disabled.rows.map((r) => r.id)).toEqual([phones[1]!.id]);
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(0);
  });

  it('fails a row on any other receipt error, leaves rows without a receipt sent, and stops asking after 24 hours', async () => {
    const { w } = await sentPushes();
    const [first] = await deliveriesOf(w.workers[0].id);
    pushSender(t).receiptFor = (id) => (id === first!.provider_ref ? { ok: false, error: 'MessageRateExceeded', message: 'slow down' } : undefined);
    clock.set('2026-11-02T05:00:00Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(1);
    expect((await deliveriesOf(w.workers[0].id)).map((d) => [d.status, d.last_error])).toEqual([
      ['failed', 'MessageRateExceeded: slow down'],
      ['sent', null],
    ]);
    const asked: string[][] = [];
    const receipts = vi.spyOn(pushSender(t), 'receipts').mockImplementation(async (ids) => (asked.push(ids), new Map()));
    clock.set('2026-11-03T04:00:01Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(0);
    expect(asked).toEqual([]);
    receipts.mockRestore();
    expect((await deliveriesOf(w.workers[0].id)).map((d) => d.status)).toEqual(['failed', 'sent']);
  });

  it('asks Expo for receipts outside any transaction', async () => {
    const { w } = await sentPushes();
    const db = t.app.get(DbService);
    let inTransaction: boolean | null = null;
    vi.spyOn(pushSender(t), 'receipts').mockImplementation(async (ids) => {
      inTransaction = (() => {
        try {
          db.tx();
          return true;
        } catch {
          return false;
        }
      })();
      return new Map(ids.map((id) => [id, { ok: true }]));
    });
    clock.set('2026-11-02T04:15:00Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(2);
    expect(inTransaction).toBe(false);
  });

  it('re-sends fan-out for events stuck for 2 minutes and delivery for rows queued for 5, below 5 attempts', async () => {
    const w = await taskWorld(t);
    await addDevice(w.s.tenantId, w.workers[0].id);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[1].id }));
    const [stuck, tired] = await eventRows(w.s.tenantId);
    await ownerQuery('update notification_events set attempts = 5 where id = $1', [tired!.id]);
    const send = vi.spyOn(t.app.get(JobsService), 'send').mockResolvedValue(true);
    clock.set('2026-11-02T04:01:59Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    clock.set('2026-11-02T04:02:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(send).toHaveBeenCalledWith('notifications.fanout', { tenantId: w.s.tenantId, eventId: stuck!.id });
    send.mockClear();
    clock.set(MONDAY_0800);
    // With send mocked, the fan-out's own after-commit deliver job is swallowed: the row stays queued.
    await t.app.get(NotificationFanout).run({ tenantId: w.s.tenantId, eventId: stuck!.id });
    const [queued] = await deliveriesOf(w.workers[0].id);
    clock.set('2026-11-02T04:04:59Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    clock.set('2026-11-02T04:05:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(send).toHaveBeenCalledWith('notifications.deliver', { tenantId: w.s.tenantId, deliveryIds: [queued!.id] });
    await ownerQuery('update notification_deliveries set attempts = 5 where id = $1', [queued!.id]);
    send.mockClear();
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('counts an interrupted claim as an attempt, re-sends below 5 attempts, and leaves live claims and fresh releases alone', async () => {
    const w = await taskWorld(t);
    for (let i = 0; i < 4; i++) await addDevice(w.s.tenantId, w.workers[0].id);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await fanOutAll(t, w.s.tenantId);
    const [stale, staleTired, live, released] = await deliveriesOf(w.workers[0].id);
    // Rows were created at 04:00. A run that died after claiming at 04:00, one that already had 4 attempts, a run
    // still holding its 04:02 claim, and a row whose failed attempt released it at 04:03 (pg-boss retries it).
    await ownerQuery("update notification_deliveries set claimed_at = '2026-11-02T04:00:00Z' where id = $1", [stale!.id]);
    await ownerQuery("update notification_deliveries set claimed_at = '2026-11-02T04:00:00Z', attempts = 4 where id = $1", [staleTired!.id]);
    await ownerQuery("update notification_deliveries set claimed_at = '2026-11-02T04:02:00Z' where id = $1", [live!.id]);
    await ownerQuery("update notification_deliveries set attempts = 1, last_error = 'boom', updated_at = '2026-11-02T04:03:00Z' where id = $1", [released!.id]);
    const send = vi.spyOn(t.app.get(JobsService), 'send').mockResolvedValue(true);
    clock.set('2026-11-02T04:05:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(send.mock.calls).toEqual([['notifications.deliver', { tenantId: w.s.tenantId, deliveryIds: [stale!.id] }]]);
    const rows = await ownerQuery<{ id: string; status: string; attempts: number; last_error: string | null; claimed: boolean }>(
      'select id, status, attempts, last_error, claimed_at is not null as claimed from notification_deliveries where id = any($1) order by device_id',
      [[stale!.id, staleTired!.id, live!.id, released!.id]],
    );
    expect(rows.rows).toEqual([
      { id: stale!.id, status: 'queued', attempts: 1, last_error: 'delivery interrupted', claimed: false },
      { id: staleTired!.id, status: 'failed', attempts: 5, last_error: 'delivery interrupted', claimed: false },
      { id: live!.id, status: 'queued', attempts: 0, last_error: null, claimed: true },
      { id: released!.id, status: 'queued', attempts: 1, last_error: 'boom', claimed: false },
    ]);
  });

  it('logs a failed send and does not count it', async () => {
    const w = await taskWorld(t);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const send = vi.spyOn(t.app.get(JobsService), 'send').mockRejectedValue(new Error('jobs startup failed'));
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    clock.set('2026-11-02T04:02:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('deletes notifications and processed events after 90 days and disables devices idle for 180', async () => {
    const w = await taskWorld(t);
    const idle = await addDevice(w.s.tenantId, w.workers[0].id);
    const fresh = await addDevice(w.s.tenantId, w.workers[1].id);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[1].id }));
    await fanOutAll(t, w.s.tenantId);
    const [old, recent] = await eventRows(w.s.tenantId);
    const unprocessed = uuidv7();
    await ownerQuery(
      "insert into notification_events (id, tenant_id, type, payload, created_at) values ($1, $2, 'task.overdue', '{}'::jsonb, '2026-01-01T00:00:00Z')",
      [unprocessed, w.s.tenantId],
    );
    await ownerQuery("update notification_events set created_at = '2026-08-03T03:59:59Z' where id = $1", [old!.id]);
    await ownerQuery("update notifications set created_at = '2026-08-03T03:59:59Z' where event_id = $1", [old!.id]);
    await ownerQuery("update push_devices set last_seen_at = '2026-05-06T03:59:59Z' where id = $1", [idle.id]);
    // now − 90 days = 2026-08-04T04:00Z; now − 180 days = 2026-05-06T04:00Z.
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(3);
    expect(await inboxOf(w.workers[0].id)).toEqual([]);
    expect(await deliveriesOf(w.workers[0].id)).toEqual([]);
    expect((await inboxOf(w.workers[1].id)).map((n) => n.event_id)).toEqual([recent!.id]);
    expect((await eventRows(w.s.tenantId)).map((e) => e.id).sort()).toEqual([recent!.id, unprocessed].sort());
    const devices = await ownerQuery<{ id: string; disabled: boolean }>('select id, disabled_at is not null as disabled from push_devices where id = any($1) order by id', [[idle.id, fresh.id]]);
    expect(devices.rows).toEqual([{ id: idle.id, disabled: true }, { id: fresh.id, disabled: false }]);
  });

  it('also deletes events that gave up after 5 attempts, never other unprocessed ones', async () => {
    const w = await taskWorld(t);
    const [gaveUp, retrying] = [uuidv7(), uuidv7()];
    for (const [id, attempts] of [[gaveUp, 5], [retrying, 4]] as const) {
      await ownerQuery(
        "insert into notification_events (id, tenant_id, type, payload, attempts, created_at) values ($1, $2, 'task.overdue', '{}'::jsonb, $3, '2026-01-01T00:00:00Z')",
        [id, w.s.tenantId, attempts],
      );
    }
    await jobs.cleanupAll([w.s.tenantId]);
    expect((await eventRows(w.s.tenantId)).map((e) => e.id)).toEqual([retrying]);
  });
});

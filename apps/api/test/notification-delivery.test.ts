import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDelivery, ticketErrorText } from '../src/notifications/notification-delivery';
import { NOTIFICATION_QUEUES } from '../src/notifications/queues';
import { JobsService } from '../src/scheduling/jobs.service';
import { TaskJobs } from '../src/tasks/task-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addDevice, deliverAll, deliveriesOf, fanOutAll, inboxOf, pushSender, staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { createTask, newTaskBody, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;
const emailRule = { enabled: true, push: true, email: true, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null };

describe('notification delivery', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    pushSender(t).reset();
    t.mailer.sent.length = 0;
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A task for İşçi 1, fanned out; İşçi 1 has `devices` phones. */
  async function assigned(devices = 1, body: Record<string, unknown> = {}) {
    const w = await taskWorld(t);
    const phones = [];
    for (let i = 0; i < devices; i++) phones.push(await addDevice(w.s.tenantId, w.workers[0].id));
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, body));
    await fanOutAll(t, w.s.tenantId);
    return { w, task, phones };
  }

  it('pushes every field to each device, with the unread count as the badge, and stores the tickets', async () => {
    const { w, task, phones } = await assigned(2);
    clock.set('2026-11-02T04:00:10Z');
    await deliverAll(t, w.s.tenantId);
    const [n] = await inboxOf(w.workers[0].id);
    expect(pushSender(t).sent).toEqual(
      phones.map((p) => ({
        to: p.token,
        title: 'Yeni tapşırıq',
        body: 'Soyuducunun qapısını təmir edin',
        sound: 'default',
        channelId: 'default',
        priority: 'default',
        badge: 1,
        data: { notificationId: n!.id, userId: w.workers[0].id, tenantId: w.s.tenantId, type: 'task.assigned', targetKind: 'task', targetId: task.id, targetDate: null },
      })),
    );
    for (const d of await deliveriesOf(w.workers[0].id)) {
      expect(d).toMatchObject({ status: 'sent', attempts: 1, last_error: null, provider_ref: expect.stringMatching(/^ticket-/), sent_at: new Date('2026-11-02T04:00:10Z') });
    }
  });

  it('sends overdue tasks with high priority', async () => {
    const { w } = await assigned(1, { dueAt: T('05:00') });
    await deliverAll(t, w.s.tenantId);
    pushSender(t).reset();
    clock.set(T('05:00'));
    await t.app.get(TaskJobs).sweepAll([w.s.tenantId]);
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    expect(pushSender(t).sent.map((m) => [m.title, m.priority, m.badge])).toEqual([['Tapşırıq gecikir', 'high', 2]]);
  });

  it('fails a row on an error ticket and disables the device only for DeviceNotRegistered', async () => {
    const { w, phones } = await assigned(2);
    const [gone, big] = phones;
    pushSender(t).ticketFor = (m) =>
      m.to === gone!.token ? { ok: false, error: 'DeviceNotRegistered', message: 'not registered' } : { ok: false, error: 'MessageTooBig', message: 'too big' };
    await deliverAll(t, w.s.tenantId);
    const rows = await deliveriesOf(w.workers[0].id);
    expect(rows.map((d) => [d.device_id, d.status, d.attempts, d.last_error])).toEqual([
      [gone!.id, 'failed', 1, 'DeviceNotRegistered: not registered'],
      [big!.id, 'failed', 1, 'MessageTooBig: too big'],
    ]);
    const disabled = await ownerQuery<{ id: string }>('select id from push_devices where user_id = $1 and disabled_at is not null', [w.workers[0].id]);
    expect(disabled.rows.map((r) => r.id)).toEqual([gone!.id]);
  });

  it('keeps a push token out of the stored error', async () => {
    expect(ticketErrorText({ ok: false, error: 'DeviceNotRegistered', message: 'The recipient device is not registered: "ExpoPushToken[abc-123_X]" is gone' })).toBe(
      'DeviceNotRegistered: The recipient device is not registered: "ExpoPushToken[…]" is gone',
    );
    expect(ticketErrorText({ ok: false, error: 'DeviceNotRegistered', message: 'ExponentPushToken[xyz] and ExpoPushToken[q]' })).toBe('DeviceNotRegistered: ExpoPushToken[…] and ExpoPushToken[…]');
    // End to end: a row's last_error, which message senders can read, never carries the token.
    const { w, phones } = await assigned(1);
    pushSender(t).ticketFor = (m) => ({ ok: false, error: 'DeviceNotRegistered', message: `"${m.to}" is not a registered push notification recipient` });
    await deliverAll(t, w.s.tenantId);
    const [row] = await deliveriesOf(w.workers[0].id);
    expect(row!.last_error).toBe('DeviceNotRegistered: "ExpoPushToken[…]" is not a registered push notification recipient');
    expect(row!.last_error).not.toContain(phones[0]!.token);
  });

  it('retries a failed Expo request four times and fails the rows on the fifth', async () => {
    const { w } = await assigned(1);
    pushSender(t).failWith = new Error('Expo is down');
    const [d] = await deliveriesOf(w.workers[0].id);
    const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
    for (let i = 1; i <= 4; i++) {
      await expect(t.app.get(NotificationDelivery).run(job)).rejects.toThrow('Expo is down');
      expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'queued', attempts: i, last_error: 'Expo is down' });
    }
    const deadLetter = vi.spyOn(t.app.get(JobsService), 'send');
    await t.app.get(NotificationDelivery).run(job);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'failed', attempts: 5, last_error: 'Expo is down' });
    expect(deadLetter).toHaveBeenCalledWith(NOTIFICATION_QUEUES.dead, { queue: NOTIFICATION_QUEUES.deliver, ...job, error: 'Expo is down' });
  });

  it('skips rows of a deactivated user or a disabled device', async () => {
    const { w, phones } = await assigned(1);
    const other = await assigned(1);
    await ownerQuery('update push_devices set disabled_at = now() where id = $1', [phones[0]!.id]);
    await ownerQuery("update users set status = 'deactivated' where id = $1", [other.w.workers[0].id]);
    await deliverAll(t, w.s.tenantId);
    await deliverAll(t, other.w.s.tenantId);
    expect((await deliveriesOf(w.workers[0].id)).map((d) => [d.status, d.attempts])).toEqual([['skipped', 0]]);
    expect((await deliveriesOf(other.w.workers[0].id)).map((d) => [d.status, d.attempts])).toEqual([['skipped', 0]]);
    expect(pushSender(t).sent).toEqual([]);
  });

  it('ignores deliveries that are no longer queued', async () => {
    const { w } = await assigned(1);
    const [d] = await deliveriesOf(w.workers[0].id);
    const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
    await t.app.get(NotificationDelivery).run(job);
    // The sweep re-sent the job while the first run finished, or pg-boss retried a job whose work had committed.
    await t.app.get(NotificationDelivery).run(job);
    expect(pushSender(t).sent).toHaveLength(1);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('sends once when a second run for the same rows starts while the first waits on Expo', async () => {
    const { w } = await assigned(1);
    const [d] = await deliveriesOf(w.workers[0].id);
    const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
    const { reached, release } = pushSender(t).hold();
    const first = t.app.get(NotificationDelivery).run(job);
    await reached;
    // The claim committed before the Expo call: the overlapping run finds the row claimed and leaves it alone.
    await t.app.get(NotificationDelivery).run(job);
    release();
    await first;
    expect(pushSender(t).sent).toHaveLength(1);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('warns with the delivery ids when the result of an attempt finds the claim lost', async () => {
    const { w } = await assigned(1);
    const [d] = await deliveriesOf(w.workers[0].id);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { reached, release } = pushSender(t).hold();
    const run = t.app.get(NotificationDelivery).run({ tenantId: w.s.tenantId, deliveryIds: [d!.id] });
    await reached;
    // Another run took the row over (its claim expired) while this one waited on Expo.
    await ownerQuery("update notification_deliveries set claimed_at = claimed_at + interval '1 second' where id = $1", [d!.id]);
    release();
    await run;
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(d!.id));
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('takes over a claim older than 5 minutes, as after a crashed run', async () => {
    const { w } = await assigned(1);
    const [d] = await deliveriesOf(w.workers[0].id);
    const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
    await ownerQuery("update notification_deliveries set claimed_at = $2::timestamptz - interval '4 minutes 59 seconds' where id = $1", [d!.id, MONDAY_0800]);
    await t.app.get(NotificationDelivery).run(job);
    expect(pushSender(t).sent).toEqual([]);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'queued', attempts: 0 });
    clock.advanceMinutes(1);
    await t.app.get(NotificationDelivery).run(job);
    expect(pushSender(t).sent).toHaveLength(1);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  describe('email', () => {
    async function mailed() {
      const w = await taskWorld(t);
      expect((await w.owner.put('/api/v1/notification-rules/task.assigned', emailRule)).status).toBe(200);
      const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 2');
      const task = await createTask(w.owner, newTaskBody({ userId: manager.id }));
      await fanOutAll(t, w.s.tenantId);
      return { w, manager, task };
    }

    it('mails the title and body with a link to the task', async () => {
      const { w, manager, task } = await mailed();
      await deliverAll(t, w.s.tenantId);
      expect(t.mailer.lastTo(manager.email)).toEqual({
        to: manager.email,
        subject: 'Yeni tapşırıq',
        text: `Soyuducunun qapısını təmir edin\n\nAçmaq üçün: http://localhost:5173/tasks?task=${task.id}\n\nBu e-poçtları profil ayarlarında söndürə bilərsiniz.`,
      });
      expect((await deliveriesOf(manager.id)).map((d) => [d.channel, d.status, d.attempts])).toEqual([['email', 'sent', 1]]);
    });

    it('fails on a permanent SMTP reply, retries a temporary one, and skips a user who opted out since', async () => {
      const { w, manager } = await mailed();
      const [d] = await deliveriesOf(manager.id);
      const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
      const send = vi.spyOn(t.mailer, 'send').mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }));
      await expect(t.app.get(NotificationDelivery).run(job)).rejects.toThrow('connection reset');
      expect((await deliveriesOf(manager.id))[0]).toMatchObject({ status: 'queued', attempts: 1 });
      send.mockRejectedValueOnce(Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 }));
      await t.app.get(NotificationDelivery).run(job);
      expect((await deliveriesOf(manager.id))[0]).toMatchObject({ status: 'failed', attempts: 2, last_error: '550 mailbox unavailable' });

      const second = await mailed();
      await ownerQuery('update users set email_notifications = false where id = $1', [second.manager.id]);
      await deliverAll(t, second.w.s.tenantId);
      expect((await deliveriesOf(second.manager.id)).map((x) => x.status)).toEqual(['skipped']);
      expect(t.mailer.lastTo(second.manager.email)).toBeUndefined();
    });
  });
});

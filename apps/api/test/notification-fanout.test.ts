import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationEvents } from '../src/notifications/notification-events';
import { NotificationFanout } from '../src/notifications/notification-fanout';
import { NotificationRecipients } from '../src/notifications/notification-recipients';
import { JobsService } from '../src/scheduling/jobs.service';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addDevice, deliveriesOf, eventRows, fanOutAll, inboxOf, staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { closedRunWithProblems, createTask, newTaskBody, taskWorld } from './task-fixtures';

const rule = (over: Record<string, unknown> = {}) => ({ enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, ...over });

describe('notification fan-out', () => {
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

  it('writes the inbox row and one queued push per active device, marks the event, and queues delivery after commit', async () => {
    const w = await taskWorld(t);
    const worker = w.workers[0];
    const phone = await addDevice(w.s.tenantId, worker.id);
    const tablet = await addDevice(w.s.tenantId, worker.id);
    const old = await addDevice(w.s.tenantId, worker.id);
    await ownerQuery('update push_devices set disabled_at = now() where id = $1', [old.id]);
    const task = await createTask(w.manager.api, newTaskBody({ userId: worker.id }));
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    clock.set('2026-11-02T04:00:05Z');
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['fanned_out']);
    expect(await inboxOf(worker.id)).toEqual([
      expect.objectContaining({ type: 'task.assigned', title: 'Yeni tapşırıq', body: 'Soyuducunun qapısını təmir edin', target_kind: 'task', target_id: task.id, target_date: null, read_at: null, created_at: new Date('2026-11-02T04:00:05Z') }),
    ]);
    const deliveries = await deliveriesOf(worker.id);
    expect(deliveries.map((d) => [d.channel, d.device_id, d.status, d.attempts])).toEqual(
      [['push', phone.id, 'queued', 0], ['push', tablet.id, 'queued', 0]].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    );
    const [event] = await eventRows(w.s.tenantId);
    expect(event).toMatchObject({ outcome: 'fanned_out', attempts: 1, processed_at: new Date('2026-11-02T04:00:05Z'), last_error: null });
    expect(send).toHaveBeenCalledWith('notifications.deliver', { tenantId: w.s.tenantId, deliveryIds: expect.arrayContaining(deliveries.map((d) => d.id)) });
    expect(await t.app.get(NotificationFanout).run({ tenantId: w.s.tenantId, eventId: event!.id })).toBe('already_processed');
    expect(await inboxOf(worker.id)).toHaveLength(1);
    expect(await inboxOf(w.manager.id)).toEqual([]);
  });

  it('renders the due time in Baku time and links the occurrence by its date', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const today = (await occurrenceRows(a.id))[0]!;
    await fanOutAll(t, w.s.tenantId); // checklist.assigned
    clock.set('2026-11-02T06:30:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['fanned_out']);
    expect((await inboxOf(w.workers[0]!)).map((n) => [n.type, n.title, n.body, n.target_kind, n.target_id, n.target_date])).toEqual([
      ['checklist.assigned', 'Yeni checklist təyin edildi', 'Açılış yoxlaması — Filial 1', 'none', null, null],
      ['checklist.overdue', 'Checklist gecikir', 'Açılış yoxlaması — Filial 1. Son vaxt 10:00 idi (02.11.2026).', 'occurrence', today.id, '2026-11-02'],
    ]);
  });

  it('emails a critical problem to role holders who have an address and did not opt out', async () => {
    const run = await closedRunWithProblems(t, clock);
    const w = run.w;
    const here = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 1');
    const admin = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    await ownerQuery('update users set email_notifications = false where id = $1', [admin.id]);
    expect((await fanOutAll(t, w.s.tenantId)).sort()).toEqual(['fanned_out', 'fanned_out', 'fanned_out']);
    const managerInbox = await inboxOf(here.id);
    expect(managerInbox.map((n) => n.type).sort()).toEqual(['problem.critical', 'problem.recorded']);
    const critical = managerInbox.find((n) => n.type === 'problem.critical')!;
    expect(critical).toMatchObject({ title: 'Kritik problem!', body: 'Filial 1, İcra yoxlaması: Kondisioner xarabdır', target_kind: 'occurrence', target_id: w.occurrenceId, target_date: '2026-11-02' });
    expect((await deliveriesOf(here.id)).map((d) => [d.notification_id, d.channel])).toEqual([[critical.id, 'email']]);
    expect((await inboxOf(admin.id)).map((n) => n.type)).toEqual(['problem.critical']);
    expect(await deliveriesOf(admin.id)).toEqual([]);
    expect(await inboxOf(w.workers[0].id)).toEqual([expect.objectContaining({ type: 'checklist.assigned' })]);
  });

  it('renders each recipient’s inbox row in that recipient’s language, the tenant’s for those without a choice', async () => {
    const run = await closedRunWithProblems(t, clock);
    const w = run.w;
    const inRussian = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Менеджер');
    const inEnglish = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    const noChoice = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 2');
    await ownerQuery('update users set locale = $2 where id = $1', [inRussian.id, 'ru']);
    await ownerQuery('update users set locale = $2 where id = $1', [inEnglish.id, 'en']);
    await fanOutAll(t, w.s.tenantId);
    const critical = async (userId: string) => (await inboxOf(userId)).find((n) => n.type === 'problem.critical');
    expect(await critical(inRussian.id)).toMatchObject({ title: 'Критичная проблема!', body: 'Filial 1, İcra yoxlaması: Kondisioner xarabdır' });
    expect(await critical(inEnglish.id)).toMatchObject({ title: 'Critical problem!', body: 'Filial 1, İcra yoxlaması: Kondisioner xarabdır' });
    expect(await critical(noChoice.id)).toMatchObject({ title: 'Kritik problem!' });
  });

  it('marks disabled rules, gone targets and empty audiences as processed with their outcome', async () => {
    const w = await taskWorld(t);
    expect((await w.owner.put('/api/v1/notification-rules/task.assigned', rule({ enabled: false }))).status).toBe(200);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['disabled']);
    expect((await w.owner.delete('/api/v1/notification-rules/task.assigned')).status).toBe(200);
    // The manager assigns a task to themselves: the actor is never notified.
    await createTask(w.manager.api, newTaskBody({ userId: w.manager.id }));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['no_recipients']);
    await t.app.get(DbService).withTenant(w.s.tenantId, null, () => t.app.get(NotificationEvents).create('task.overdue', { taskId: uuidv7() }, null));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['target_gone']);
    expect((await eventRows(w.s.tenantId)).map((e) => [e.outcome, e.attempts, e.processed_at !== null])).toEqual([
      ['disabled', 1, true],
      ['no_recipients', 1, true],
      ['target_gone', 1, true],
    ]);
    expect(await inboxOf(w.workers[0].id)).toEqual([]);
  });

  it('fans a manual message out to the sender’s targets with email when asked', async () => {
    const w = await taskWorld(t);
    await ownerQuery("update users set email = $2 where id = $1", [w.workers[0].id, `isci1-${w.s.tenantId}@example.az`]);
    const payload = { title: 'Diqqət', body: 'Sabah iclas var.', userIds: [], teamIds: [w.teamId], siteIds: [], email: true };
    await t.app.get(DbService).withTenant(w.s.tenantId, w.s.ownerId, () => t.app.get(NotificationEvents).create('manual', payload, w.s.ownerId));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['fanned_out']);
    for (const u of [w.workers[0], w.workers[1]]) {
      expect((await inboxOf(u.id)).map((n) => [n.type, n.title, n.body, n.target_kind])).toEqual([['manual', 'Diqqət', 'Sabah iclas var.', 'none']]);
    }
    expect((await deliveriesOf(w.workers[0].id)).map((d) => d.channel)).toEqual(['email']);
    expect(await deliveriesOf(w.workers[1].id)).toEqual([]);
    expect(await inboxOf(w.s.ownerId)).toEqual([]);
  });

  it('counts failed attempts and gives up after the fifth, into notifications.dead', async () => {
    const w = await taskWorld(t);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const [event] = await eventRows(w.s.tenantId);
    vi.spyOn(t.app.get(NotificationRecipients), 'resolve').mockRejectedValue(new Error('boom'));
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const fanout = t.app.get(NotificationFanout);
    const job = { tenantId: w.s.tenantId, eventId: event!.id };
    for (let i = 1; i <= 4; i++) {
      await expect(fanout.run(job)).rejects.toThrow('boom');
      expect((await eventRows(w.s.tenantId))[0]).toMatchObject({ attempts: i, last_error: 'boom', processed_at: null });
    }
    expect(await fanout.run(job)).toBe('failed');
    expect((await eventRows(w.s.tenantId))[0]).toMatchObject({ attempts: 5, last_error: 'boom', processed_at: null, outcome: null });
    expect(send).toHaveBeenCalledWith('notifications.dead', { queue: 'notifications.fanout', ...job, error: 'boom' });
    expect(await inboxOf(w.workers[0].id)).toEqual([]);
  });

  it('still gives up on the fifth attempt when the dead letter cannot be sent', async () => {
    const w = await taskWorld(t);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const [event] = await eventRows(w.s.tenantId);
    await ownerQuery('update notification_events set attempts = 4 where id = $1', [event!.id]);
    vi.spyOn(t.app.get(NotificationRecipients), 'resolve').mockRejectedValue(new Error('boom'));
    vi.spyOn(t.app.get(JobsService), 'send').mockRejectedValue(new Error('jobs did not start'));
    expect(await t.app.get(NotificationFanout).run({ tenantId: w.s.tenantId, eventId: event!.id })).toBe('failed');
    expect((await eventRows(w.s.tenantId))[0]).toMatchObject({ attempts: 5, last_error: 'boom', processed_at: null });
  });
});

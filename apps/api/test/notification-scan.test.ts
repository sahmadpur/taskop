import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationJobs } from '../src/notifications/notification-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { eventRows } from './notification-fixtures';
import { createAssignment, fixed, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';

const at = (hhmmss: string) => `2026-11-02T${hhmmss}Z`;
const rule = (over: Record<string, unknown>) => ({ enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, ...over });

describe('notifications.scan', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: NotificationJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(NotificationJobs);
  });
  beforeEach(() => clock.set('2026-11-02T03:00:00Z'));
  afterAll(() => t.close());

  /** Today's run 08:00–10:00 Baku (04:00Z–06:00Z), created an hour before it opens. */
  async function world(timing = fixed()) {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { timing });
    const today = (await occurrenceRows(a.id))[0]!;
    const scan = async (iso: string) => {
      clock.set(iso);
      return jobs.scanAll([w.s.tenantId]);
    };
    const scanned = async () =>
      (await eventRows(w.s.tenantId)).filter((e) => e.type === 'checklist.available' || e.type === 'checklist.due_soon').map((e) => [e.type, e.dedupe_key, e.actor_user_id, e.payload]);
    return { w, today, scan, scanned };
  }

  it('records checklist.available once when the run opens', async () => {
    const { today, scan, scanned } = await world();
    expect(await scan(at('03:59:59'))).toBe(0);
    expect(await scan(at('04:00:00'))).toBe(1);
    expect(await scan(at('04:01:00'))).toBe(0);
    expect(await scanned()).toEqual([['checklist.available', `checklist.available:${today.id}`, null, { occurrenceId: today.id }]]);
  });

  it('records nothing for runs that opened more than 15 minutes ago', async () => {
    const { scan, scanned } = await world();
    expect(await scan(at('04:15:01'))).toBe(0);
    expect(await scanned()).toEqual([]);
    const late = await world();
    expect(await late.scan(at('04:15:00'))).toBe(1);
  });

  it('records checklist.due_soon once, the lead time before the due time', async () => {
    const { today, scan, scanned } = await world();
    await scan(at('04:00:00'));
    expect(await scan(at('05:29:59'))).toBe(0);
    expect(await scan(at('05:30:00'))).toBe(1);
    expect(await scan(at('05:45:00'))).toBe(0);
    expect((await scanned()).at(-1)).toEqual(['checklist.due_soon', `checklist.due_soon:${today.id}`, null, { occurrenceId: today.id }]);
  });

  it('uses the tenant’s lead time and skips a window shorter than it', async () => {
    const long = await world();
    expect((await long.w.api.put('/api/v1/notification-rules/checklist.due_soon', rule({ leadMinutes: 60 }))).status).toBe(200);
    expect(await long.scan(at('04:59:59'))).toBe(0);
    expect(await long.scan(at('05:00:00'))).toBe(1);
    // Due 20 minutes after opening with a 30-minute lead: only checklist.available is sent.
    const short = await world(fixed('08:00', 20));
    expect(await short.scan(at('04:00:00'))).toBe(1);
    expect(await short.scan(at('04:10:00'))).toBe(0);
    expect((await short.scanned()).map(([type]) => type)).toEqual(['checklist.available']);
  });

  it('records nothing for disabled rules, or once the run is no longer pending', async () => {
    const off = await world();
    expect((await off.w.api.put('/api/v1/notification-rules/checklist.available', rule({ enabled: false }))).status).toBe(200);
    expect((await off.w.api.put('/api/v1/notification-rules/checklist.due_soon', rule({ enabled: false, leadMinutes: 30 }))).status).toBe(200);
    expect(await off.scan(at('04:00:00'))).toBe(0);
    expect(await off.scan(at('05:30:00'))).toBe(0);
    const cancelled = await world();
    const res = await cancelled.w.api.post(`/api/v1/occurrences/${cancelled.today.id}/cancel`, { reason: 'Bu gün bağlıdır' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await cancelled.scan(at('04:00:00'))).toBe(0);
  });

  it('still announces a short window that already closed during downtime, once', async () => {
    // Due 5 minutes after opening (04:05Z); the scan only comes back at 04:10Z.
    const { today, scan, scanned } = await world(fixed('08:00', 5));
    expect(await scan(at('04:10:00'))).toBe(1);
    expect(await scan(at('04:11:00'))).toBe(0);
    expect(await scanned()).toEqual([['checklist.available', `checklist.available:${today.id}`, null, { occurrenceId: today.id }]]);
  });
});

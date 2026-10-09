import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { JobsService, QUEUES } from '../src/scheduling/jobs.service';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, fixed, live, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';

const historyOf = async (occurrenceId: string) =>
  (
    await ownerQuery<{ from_status: string | null; to_status: string; at: Date; actor_user_id: string | null }>(
      'select from_status, to_status, at, actor_user_id from occurrence_status_history where occurrence_id = $1 order by at, id',
      [occurrenceId],
    )
  ).rows.map((r) => [r.from_status, r.to_status, r.at.toISOString(), r.actor_user_id === null ? 'system' : 'user']);

describe('occurrence jobs', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: OccurrenceJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(OccurrenceJobs);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('extends the horizon by a day when time moves on, and is idempotent', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    clock.set('2026-11-03T04:00:00Z');
    expect(await jobs.materializeAll([w.s.tenantId])).toBe(1);
    expect(await jobs.materializeAll([w.s.tenantId])).toBe(0);
    const rows = await occurrenceRows(a.id);
    expect(rows).toHaveLength(16);
    expect(rows.at(-1)!.local_date).toBe('2026-11-17');
  });

  it('a cancelled slot is never recreated by the cron', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const second = (await occurrenceRows(a.id))[1]!;
    await ownerQuery("update occurrences set status = 'cancelled', cancel_reason = 'Bayram' where id = $1", [second.id]);
    clock.set('2026-11-03T04:00:00Z');
    await jobs.materializeAll([w.s.tenantId]);
    const rows = live(await occurrenceRows(a.id));
    expect(rows.map((r) => r.local_date)).not.toContain('2026-11-03');
    expect(rows).toHaveLength(15);
  });

  it('moves pending → overdue → missed with history at the real due and close times', async () => {
    const w = await schedulingWorld(t);
    const first = (await occurrenceRows((await createAssignment(w)).id))[0]!;
    clock.set('2026-11-02T06:30:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(await historyOf(first.id)).toEqual([
      [null, 'pending', '2026-11-02T04:00:00.000Z', 'user'],
      ['pending', 'overdue', '2026-11-02T06:00:00.000Z', 'system'],
      ['overdue', 'missed', '2026-11-02T07:00:00.000Z', 'system'],
    ]);
    const row = await ownerQuery<{ status: string; status_changed_at: Date }>('select status, status_changed_at from occurrences where id = $1', [first.id]);
    expect(row.rows[0]).toMatchObject({ status: 'missed', status_changed_at: new Date('2026-11-02T07:00:00Z') });
  });

  it('never records a sweep transition before the occurrence was created', async () => {
    const w = await schedulingWorld(t);
    clock.set('2026-11-02T05:30:00Z'); // 09:30: today's window (due 09:00, closes 11:00) is already overdue
    const first = (await occurrenceRows((await createAssignment(w, { timing: fixed('08:00', 60, 120) })).id))[0]!;
    clock.set('2026-11-02T05:31:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(await historyOf(first.id)).toEqual([
      [null, 'pending', '2026-11-02T05:30:00.000Z', 'user'],
      ['pending', 'overdue', '2026-11-02T05:30:00.000Z', 'system'],
    ]);
    const row = await ownerQuery<{ status_changed_at: Date }>('select status_changed_at from occurrences where id = $1', [first.id]);
    expect(row.rows[0]!.status_changed_at).toEqual(new Date('2026-11-02T05:30:00Z'));
  });

  it('jumps straight to missed with two history rows after downtime', async () => {
    const w = await schedulingWorld(t);
    const rows = await occurrenceRows((await createAssignment(w)).id);
    clock.set('2026-11-03T12:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(2);
    expect(await historyOf(rows[0]!.id)).toEqual([
      [null, 'pending', '2026-11-02T04:00:00.000Z', 'user'],
      ['pending', 'overdue', '2026-11-02T06:00:00.000Z', 'system'],
      ['overdue', 'missed', '2026-11-02T07:00:00.000Z', 'system'],
    ]);
    expect((await historyOf(rows[1]!.id)).slice(1).map((h) => h[1])).toEqual(['overdue', 'missed']);
  });

  it('records a single pending → missed when there is no grace period', async () => {
    const w = await schedulingWorld(t);
    const first = (await occurrenceRows((await createAssignment(w, { timing: fixed('08:00', 120, 0) })).id))[0]!;
    clock.set('2026-11-02T06:00:00Z');
    await jobs.sweepAll([w.s.tenantId]);
    expect((await historyOf(first.id)).slice(1)).toEqual([['pending', 'missed', '2026-11-02T06:00:00.000Z', 'system']]);
  });

  it('emits occurrence.status_changed for every transition', async () => {
    const w = await schedulingWorld(t);
    await createAssignment(w);
    const seen: string[] = [];
    const off = t.app.get(DomainEvents).on('occurrence.status_changed', (e) => {
      if (e.tenantId === w.s.tenantId && e.from) seen.push(`${e.from}->${e.to}`);
    });
    try {
      clock.set('2026-11-02T06:30:00Z');
      await jobs.sweepAll([w.s.tenantId]);
    } finally {
      off();
    }
    expect(seen).toEqual(['pending->overdue']);
  });

  it('one tenant failing does not block the others', async () => {
    const bad = await schedulingWorld(t);
    const badA = await createAssignment(bad);
    await ownerQuery(`update assignments set schedule = '{"kind":"bogus"}'::jsonb where id = $1`, [badA.id]);
    const good = await schedulingWorld(t);
    const goodA = await createAssignment(good);
    clock.set('2026-11-03T04:00:00Z');
    await expect(jobs.materializeAll([bad.s.tenantId, good.s.tenantId])).rejects.toThrow(/1 tenant/);
    expect(await occurrenceRows(goodA.id)).toHaveLength(16);
  });
});

describe('pg-boss wiring', () => {
  it('runs a sweep through a real queue', async () => {
    const clock = new FakeClock(MONDAY_0800);
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' }, { clock });
    try {
      const w = await schedulingWorld(t);
      const first = (await occurrenceRows((await createAssignment(w)).id))[0]!;
      clock.set('2026-11-02T06:30:00Z');
      await t.app.get(JobsService).runNow(QUEUES.sweep, [w.s.tenantId]);
      await expect
        .poll(async () => (await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [first.id])).rows[0]!.status, {
          timeout: 20_000,
          interval: 250,
        })
        .toBe('overdue');
    } finally {
      await t.close();
    }
  });

  it('registers cron schedules only while JOBS_CRON is on and uses stately queues', async () => {
    const schedules = async () =>
      (await ownerQuery<{ name: string }>("select name from pgboss.schedule where name like 'occurrences.%' order by name")).rows.map((r) => r.name);
    // Cron jobs run for every tenant in the shared test database; a clock long in the past makes them no-ops,
    // so they never sweep or extend other test files' occurrences.
    const past = new FakeClock('2020-01-01T00:00:00Z');
    const on = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'true' }, { clock: past });
    try {
      expect(await schedules()).toEqual([QUEUES.materialize, QUEUES.sweep]);
      const policies = await ownerQuery<{ name: string; policy: string }>("select name, policy from pgboss.queue where name in ($1, $2) order by name", [
        QUEUES.materialize,
        QUEUES.sweep,
      ]);
      expect(policies.rows.map((r) => r.policy)).toEqual(['stately', 'stately']);
    } finally {
      await on.close();
    }
    const off = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' }, { clock: past });
    try {
      expect(await schedules()).toEqual([]);
    } finally {
      await off.close();
    }
  });
});

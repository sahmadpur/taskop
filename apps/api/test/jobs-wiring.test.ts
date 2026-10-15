import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_JOB_QUEUES, AUDIT_REPORT_JOB } from '../src/audits/report/queues';
import { loadConfig } from '../src/config/config';
import { MEDIA_CLEANUP_QUEUE } from '../src/executions/media-jobs';
import { NOTIFICATION_QUEUES, NOTIFICATION_WORKER } from '../src/notifications/queues';
import type { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { JobsService, QUEUES } from '../src/scheduling/jobs.service';
import { TASK_MEDIA_CLEANUP_QUEUE, TASK_SWEEP_QUEUE } from '../src/tasks/task-jobs';
import { createTestApp, testEnv } from './app';
import { liveExecution, mediaRow, registerBytes } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { addDevice, deliveriesOf, inboxOf } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { type Seaweed, startSeaweedfs } from './seaweedfs';
import { createTask, newTaskBody, taskMediaBody, taskRow, taskWorld } from './task-fixtures';

/**
 * Every test that starts an app with JOBS_ENABLED lives in this file. All of them share one Postgres and one
 * pg-boss schema, and every jobs-enabled app registers a worker for every queue, so two such apps running at
 * once in different test files could steal each other's jobs (a fake-clock app or one with a dead S3 would
 * process another file's job). Vitest runs the tests of a file one after another, which keeps them apart.
 */
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

  it('runs tasks.sweep through a real queue', async () => {
    const clock = new FakeClock(MONDAY_0800);
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' }, { clock });
    try {
      const w = await taskWorld(t);
      const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { dueAt: '2026-11-02T05:00:00.000Z' }));
      clock.set('2026-11-02T05:30:00Z');
      await t.app.get(JobsService).runNow(TASK_SWEEP_QUEUE, [w.s.tenantId]);
      await expect.poll(async () => (await taskRow(task.id)).overdue_at, { timeout: 20_000, interval: 250 }).not.toBeNull();
    } finally {
      await t.close();
    }
  });

  it('fans out and delivers a notification through real queues', { timeout: 60_000 }, async () => {
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
    try {
      const w = await taskWorld(t);
      await addDevice(w.s.tenantId, w.workers[0].id);
      await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
      await expect.poll(async () => (await inboxOf(w.workers[0].id)).map((n) => n.type), { timeout: 20_000, interval: 250 }).toEqual(['task.assigned']);
      await expect.poll(async () => (await deliveriesOf(w.workers[0].id)).map((d) => d.status), { timeout: 20_000, interval: 250 }).toEqual(['sent']);
    } finally {
      await t.close();
    }
  });

  it('runs the fan-out and delivery workers 4 at a time, polling every 0.5 s, so a burst of events fans out quickly', { timeout: 60_000 }, async () => {
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
    try {
      const boss = (t.app.get(JobsService) as unknown as { boss: PgBoss }).boss;
      for (const queue of [NOTIFICATION_QUEUES.fanout, NOTIFICATION_QUEUES.deliver]) {
        // localConcurrency 4 spawns four pg-boss workers for the queue, each taking one job per fetch.
        const workers = boss.getWipData().filter((w) => w.name === queue);
        expect(workers).toHaveLength(4);
        for (const w of workers) {
          expect(w.options).toMatchObject({ pollingIntervalSeconds: 0.5, localConcurrency: 4 });
          expect(w.options.batchSize ?? 1).toBe(1);
        }
      }
      expect(NOTIFICATION_WORKER).toEqual({ pollingIntervalSeconds: 0.5, localConcurrency: 4 });
      const w = await taskWorld(t);
      const burst = 8;
      const started = Date.now();
      for (let i = 0; i < burst; i++) await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
      await expect.poll(async () => (await inboxOf(w.workers[0].id)).length, { timeout: 20_000, interval: 100 }).toBe(burst);
      // One worker polling every 2 s (pg-boss's defaults) would need about burst × 2 s.
      expect(Date.now() - started).toBeLessThan(burst * 1_000);
    } finally {
      await t.close();
    }
  });

  it('creates the audit.report worker queue with five 15 s-doubling retries (cap 240 s) and two local workers, dead letter audit.dead', async () => {
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
    try {
      const boss = (t.app.get(JobsService) as unknown as { boss: PgBoss }).boss;
      const workers = boss.getWipData().filter((w) => w.name === AUDIT_JOB_QUEUES.report);
      expect(workers).toHaveLength(2);
      for (const w of workers) expect(w.options).toMatchObject({ localConcurrency: 2 });
      expect(AUDIT_REPORT_JOB).toMatchObject({ retryLimit: 5, retryDelay: 15, retryDelayMax: 240, localConcurrency: 2, expireInSeconds: 3600 });
      const rows = await ownerQuery<{ name: string; policy: string; retry_limit: number; retry_backoff: boolean; retry_delay: number; retry_delay_max: number | null; dead_letter: string | null; expire_seconds: number }>(
        "select name, policy, retry_limit, retry_backoff, retry_delay, retry_delay_max, dead_letter, expire_seconds from pgboss.queue where name in ('audit.report', 'audit.dead') order by name",
      );
      expect(rows.rows).toEqual([
        { name: 'audit.dead', policy: 'standard', retry_limit: 2, retry_backoff: false, retry_delay: 0, retry_delay_max: null, dead_letter: null, expire_seconds: 900 },
        { name: 'audit.report', policy: 'standard', retry_limit: 5, retry_backoff: true, retry_delay: 15, retry_delay_max: 240, dead_letter: 'audit.dead', expire_seconds: 3600 },
      ]);
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
      const notificationSchedules = await ownerQuery<{ name: string }>("select name from pgboss.schedule where name like 'notifications.%' order by name");
      expect(notificationSchedules.rows.map((r) => r.name)).toEqual(['notifications.cleanup', 'notifications.receipts', 'notifications.scan', 'notifications.sweep']);
      const workers = await ownerQuery<{ name: string; policy: string }>("select name, policy from pgboss.queue where name in ('notifications.fanout', 'notifications.deliver', 'notifications.dead') order by name");
      expect(workers.rows).toEqual([
        { name: 'notifications.dead', policy: 'standard' },
        { name: 'notifications.deliver', policy: 'standard' },
        { name: 'notifications.fanout', policy: 'standard' },
      ]);
      // Retries are spread out (15 s doubling, capped at 240 s) so the 5 attempts outlast a short Expo/SMTP outage and
      // each gap stays under the 5-minute deliver claim lease.
      const retry = await ownerQuery<{ name: string; retry_limit: number; retry_backoff: boolean; retry_delay: number; retry_delay_max: number | null }>(
        "select name, retry_limit, retry_backoff, retry_delay, retry_delay_max from pgboss.queue where name in ('notifications.fanout', 'notifications.deliver') order by name",
      );
      expect(retry.rows).toEqual([
        { name: 'notifications.deliver', retry_limit: 5, retry_backoff: true, retry_delay: 15, retry_delay_max: 240 },
        { name: 'notifications.fanout', retry_limit: 5, retry_backoff: true, retry_delay: 15, retry_delay_max: 240 },
      ]);
    } finally {
      await on.close();
    }
    const off = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' }, { clock: past });
    try {
      expect(await schedules()).toEqual([]);
      expect((await ownerQuery("select 1 from pgboss.schedule where name like 'notifications.%'")).rowCount).toBe(0);
    } finally {
      await off.close();
    }
  });

  describe('JobsService workers', () => {
    // Completes stray scheduling jobs harmlessly; this JobsService has no Nest app around it.
    const idle = { materializeAll: async () => 0, sweepAll: async () => 0 } as unknown as OccurrenceJobs;

    it('runs a defined worker for every sent job, retries a failing one and then dead-letters it', async () => {
      const jobs = new JobsService(loadConfig(testEnv({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' })), idle);
      const queue = `test.echo.${randomUUID()}`;
      const dead = `test.dead.${randomUUID()}`;
      const seen: string[] = [];
      jobs.defineWorker<{ v: string }>(
        queue,
        async (d) => {
          seen.push(d.v);
          if (d.v === 'bad') throw new Error('boom');
        },
        { retryLimit: 1, deadLetter: dead },
      );
      await jobs.onApplicationBootstrap();
      try {
        expect(await jobs.send(queue, { v: 'a' })).toBe(true);
        expect(await jobs.send(queue, { v: 'b' })).toBe(true);
        await expect.poll(() => [...seen].sort(), { timeout: 20_000, interval: 250 }).toEqual(['a', 'b']);
        await jobs.send(queue, { v: 'bad' });
        // One try and one retry (retryLimit 1), then the job moves to the dead-letter queue.
        await expect.poll(() => seen.filter((v) => v === 'bad').length, { timeout: 20_000, interval: 250 }).toBe(2);
        await expect
          .poll(async () => (await ownerQuery<{ n: number }>('select count(*)::int as n from pgboss.job where name = $1', [dead])).rows[0]!.n, { timeout: 20_000, interval: 250 })
          .toBe(1);
        const policy = await ownerQuery<{ policy: string }>('select policy from pgboss.queue where name = $1', [queue]);
        expect(policy.rows[0]!.policy).toBe('standard');
      } finally {
        await jobs.onModuleDestroy();
      }
    });

    it("runs a worker's onDead handler for a job that reaches the dead-letter queue, and applies expireInSeconds to the queue", async () => {
      const jobs = new JobsService(loadConfig(testEnv({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' })), idle);
      const queue = `test.deadhandler.${randomUUID()}`;
      const dead = `test.dead.${randomUUID()}`;
      const handled: unknown[] = [];
      jobs.defineWorker<{ v: string }>(
        queue,
        async () => {
          throw new Error('boom');
        },
        { retryLimit: 1, deadLetter: dead, expireInSeconds: 1234, onDead: async (d) => void handled.push(d) },
      );
      await jobs.onApplicationBootstrap();
      try {
        await jobs.send(queue, { v: 'x' });
        await expect.poll(() => handled, { timeout: 20_000, interval: 250 }).toEqual([{ v: 'x' }]);
        const q = await ownerQuery<{ expire_seconds: number }>('select expire_seconds from pgboss.queue where name = $1', [queue]);
        expect(q.rows[0]!.expire_seconds).toBe(1234);
      } finally {
        await jobs.onModuleDestroy();
      }
    });

    it("passes a worker's polling interval and local concurrency to pg-boss, so jobs of a burst run side by side", async () => {
      const jobs = new JobsService(loadConfig(testEnv({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' })), idle);
      const queue = `test.burst.${randomUUID()}`;
      let running = 0;
      let peak = 0;
      const done: number[] = [];
      jobs.defineWorker<{ n: number }>(
        queue,
        async (d) => {
          peak = Math.max(peak, ++running);
          await new Promise((r) => setTimeout(r, 300));
          running--;
          done.push(d.n);
        },
        { retryLimit: 1, deadLetter: `test.dead.${randomUUID()}`, pollingIntervalSeconds: 0.5, localConcurrency: 4 },
      );
      await jobs.onApplicationBootstrap();
      try {
        const started = Date.now();
        for (let n = 0; n < 8; n++) await jobs.send(queue, { n });
        await expect.poll(() => done.length, { timeout: 20_000, interval: 50 }).toBe(8);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(4);
        // Serially, at pg-boss's default 2 s poll, eight jobs take well over 8 s.
        expect(Date.now() - started).toBeLessThan(6_000);
      } finally {
        await jobs.onModuleDestroy();
      }
    });

    it('a send made while startup is still creating the queues waits for them instead of throwing', async () => {
      const jobs = new JobsService(loadConfig(testEnv({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' })), idle);
      const queue = `test.early.${randomUUID()}`;
      const seen: string[] = [];
      jobs.defineWorker<{ v: string }>(queue, async (d) => void seen.push(d.v), { retryLimit: 1, deadLetter: `test.dead.${randomUUID()}` });
      // Sent before bootstrap has even begun: pg-boss 12 would throw for a queue that does not exist yet.
      const early = jobs.send(queue, { v: 'early' });
      const bootstrap = jobs.onApplicationBootstrap();
      try {
        expect(await early).toBe(true);
        await bootstrap;
        await expect.poll(() => seen, { timeout: 20_000, interval: 250 }).toEqual(['early']);
      } finally {
        await bootstrap.catch(() => undefined);
        await jobs.onModuleDestroy();
      }
    });

    it('send rejects with the startup error instead of hanging when pg-boss cannot start', async () => {
      // Nothing listens on port 1, so boss.start() fails.
      const env = testEnv({ JOBS_ENABLED: 'true', JOBS_CRON: 'false', DATABASE_APP_URL: 'postgres://nobody:nope@127.0.0.1:1/none' });
      const jobs = new JobsService(loadConfig(env), idle);
      jobs.defineWorker('never', async () => undefined, { retryLimit: 1, deadLetter: 'never.dead' });
      const pending = jobs.send('never', { v: 1 });
      const assertion = expect(pending).rejects.toBeInstanceOf(Error);
      await expect(jobs.onApplicationBootstrap()).rejects.toBeInstanceOf(Error);
      await assertion;
      // A send after the failed startup rejects too.
      await expect(jobs.send('never', { v: 2 })).rejects.toBeInstanceOf(Error);
    });

    it('send does nothing while background jobs are disabled', async () => {
      const jobs = new JobsService(loadConfig(testEnv()), idle);
      // Returns at once, even before bootstrap: it must not wait on a startup that never happens.
      expect(await jobs.send('anything', { v: 1 })).toBe(false);
      await jobs.onApplicationBootstrap();
      expect(await jobs.send('anything', { v: 1 })).toBe(false);
      expect(() => jobs.defineWorker('late', async () => undefined, { retryLimit: 1, deadLetter: 'late.dead' })).not.toThrow();
    });
  });

  describe('media cleanup', () => {
    let sw: Seaweed;
    beforeAll(async () => {
      sw = await startSeaweedfs();
    });
    afterAll(() => sw?.stop());

    it('runs media.cleanup through a real pg-boss queue', async () => {
      const app = await createTestApp({ ...sw.env, JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
      try {
        const { w, executionId, api } = await liveExecution(app);
        const m = await registerBytes(api, executionId, null, 10);
        await ownerQuery("update execution_media set created_at = now() - interval '15 days' where id = $1", [m.id]);
        await app.app.get(JobsService).runNow(MEDIA_CLEANUP_QUEUE, [w.s.tenantId]);
        await expect.poll(async () => (await mediaRow(m.id)).purged, { timeout: 20_000, interval: 250 }).toBe(true);
      } finally {
        await app.close();
      }
    });

    it('runs task-media.cleanup through a real pg-boss queue', async () => {
      const app = await createTestApp({ ...sw.env, JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
      try {
        const w = await taskWorld(app);
        const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
        const body = taskMediaBody('instruction', { bytes: 10, capturedAt: new Date().toISOString() });
        expect((await w.manager.api.post(`/api/v1/tasks/${task.id}/media`, body)).status).toBe(200);
        await ownerQuery("update task_media set created_at = now() - interval '15 days' where id = $1", [body.id]);
        await app.app.get(JobsService).runNow(TASK_MEDIA_CLEANUP_QUEUE, [w.s.tenantId]);
        await expect
          .poll(async () => (await ownerQuery<{ purged: boolean }>('select storage_purged_at is not null as purged from task_media where id = $1', [body.id])).rows[0]!.purged, {
            timeout: 20_000,
            interval: 250,
          })
          .toBe(true);
      } finally {
        await app.close();
      }
    });
  });
});

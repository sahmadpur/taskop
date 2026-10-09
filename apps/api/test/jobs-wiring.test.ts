import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MEDIA_CLEANUP_QUEUE } from '../src/executions/media-jobs';
import { JobsService, QUEUES } from '../src/scheduling/jobs.service';
import { createTestApp } from './app';
import { liveExecution, mediaRow, registerBytes } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

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
  });
});

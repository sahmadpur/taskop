import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PgBoss, type Queue, type UpdateQueueOptions } from 'pg-boss';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { OccurrenceJobs } from './occurrence-jobs';

export const QUEUES = { materialize: 'occurrences.materialize', sweep: 'occurrences.sweep', dead: 'occurrences.dead' } as const;
type WorkQueue = typeof QUEUES.materialize | typeof QUEUES.sweep;

interface JobData {
  tenantIds?: string[];
}

/** pg-boss lifecycle (spec §5): queues, cron schedules and workers. pg-boss owns the `pgboss` schema. */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('JobsService');
  private boss: PgBoss | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ops: OccurrenceJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.JOBS_ENABLED) return;
    // `schedule: false` also stops this instance from firing schedules registered by an earlier run.
    const boss = new PgBoss({
      connectionString: this.config.DATABASE_APP_URL,
      schema: 'pgboss',
      createSchema: false,
      application_name: 'taskop-jobs',
      schedule: this.config.JOBS_CRON,
    });
    boss.on('error', (err) => this.logger.error(`pg-boss: ${String(err)}`));
    await boss.start();
    await this.ensureQueue(boss, QUEUES.dead);
    for (const name of [QUEUES.materialize, QUEUES.sweep]) {
      // stately: at most one queued and one running job, so a run requested while another is busy is not lost.
      await this.ensureQueue(boss, name, { policy: 'stately', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
    }
    await boss.work<JobData>(QUEUES.materialize, async ([job]) => {
      await this.ops.materializeAll(job?.data?.tenantIds);
    });
    await boss.work<JobData>(QUEUES.sweep, async ([job]) => {
      await this.ops.sweepAll(job?.data?.tenantIds);
    });
    await boss.work(QUEUES.dead, async (jobs) => {
      for (const j of jobs) this.logger.error(`Scheduling job ${j.id} failed after all retries`);
    });
    if (this.config.JOBS_CRON) {
      await boss.schedule(QUEUES.materialize, '*/15 * * * *', null, { tz: 'UTC', missed: 'once' });
      await boss.schedule(QUEUES.sweep, '* * * * *', null, { tz: 'UTC', missed: 'once' });
      // A freshly started API catches up at once instead of waiting for the next quarter hour.
      await boss.send(QUEUES.materialize, {});
    } else {
      for (const name of [QUEUES.materialize, QUEUES.sweep]) {
        // Drops schedules left by an earlier run with cron on; there may be none.
        await boss.unschedule(name).catch(() => undefined);
      }
    }
    this.boss = boss;
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
    this.boss = null;
  }

  /** Queues a run now; `tenantIds` limits it to those tenants. */
  async runNow(queue: WorkQueue, tenantIds?: string[]): Promise<void> {
    if (!this.boss) throw new Error('Background jobs are disabled');
    await this.boss.send(queue, tenantIds ? { tenantIds } : {});
  }

  /** Creates the queue, or brings an existing one up to date. pg-boss cannot change a queue's policy after creation. */
  private async ensureQueue(boss: PgBoss, name: string, options: Omit<Queue, 'name'> = {}): Promise<void> {
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, options);
      return;
    }
    const { policy: _policy, partition: _partition, ...updatable } = options;
    if (Object.keys(updatable).length) await boss.updateQueue(name, updatable satisfies UpdateQueueOptions);
  }
}

import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PgBoss, type Queue } from 'pg-boss';
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
    const boss = new PgBoss({ connectionString: this.config.DATABASE_APP_URL, schema: 'pgboss', createSchema: false, application_name: 'taskop-jobs' });
    boss.on('error', (err) => this.logger.error(`pg-boss: ${String(err)}`));
    await boss.start();
    await this.ensureQueue(boss, QUEUES.dead);
    for (const name of [QUEUES.materialize, QUEUES.sweep]) {
      await this.ensureQueue(boss, name, { policy: 'singleton', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
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

  private async ensureQueue(boss: PgBoss, name: string, options: Omit<Queue, 'name'> = {}): Promise<void> {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
  }
}

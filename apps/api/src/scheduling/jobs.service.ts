import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PgBoss, type Queue, type UpdateQueueOptions } from 'pg-boss';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { OccurrenceJobs } from './occurrence-jobs';

export const QUEUES = { materialize: 'occurrences.materialize', sweep: 'occurrences.sweep', dead: 'occurrences.dead' } as const;

interface JobData {
  tenantIds?: string[];
}

/** A job another module runs per tenant on a cron (e.g. media.cleanup). */
export interface JobDefinition {
  name: string;
  cron: string;
  handler: (tenantIds?: string[]) => Promise<unknown>;
}

/** Retry policy of a worker queue (SP6 spec §6.3). */
export interface WorkerOptions {
  /** pg-boss retries after the first try. */
  retryLimit: number;
  /** Seconds before the first retry; with backoff it doubles each time. pg-boss defaults to 0, which burns all retries within seconds. */
  retryDelay?: number;
  /** Cap, in seconds, on the backed-off delay between two retries. */
  retryDelayMax?: number;
  /** Receives the job once the retries are exhausted; every job there is logged at error level. */
  deadLetter: string;
  /** Seconds between two polls of an idle worker (pg-boss minimum 0.5). Defaults to pg-boss's 2. */
  pollingIntervalSeconds?: number;
  /** Workers this node runs for the queue, each taking one job at a time. Defaults to 1. */
  localConcurrency?: number;
  /** Seconds one attempt may run before pg-boss expires it and retries it. Defaults to pg-boss's 15 minutes. */
  expireInSeconds?: number;
  /** Runs for every job that reaches the dead-letter queue (after it is logged), e.g. to mark the work failed. A throw retries it. */
  onDead?: (data: object) => Promise<void>;
}

interface WorkerDefinition {
  name: string;
  handler: (data: object) => Promise<void>;
  opts: WorkerOptions;
}

/** pg-boss lifecycle (spec §5): queues, cron schedules and workers. pg-boss owns the `pgboss` schema. */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('JobsService');
  private boss: PgBoss | null = null;
  private readonly defined: JobDefinition[] = [];
  private readonly workers: WorkerDefinition[] = [];
  /**
   * Settles once startup has created ALL queues (crons, workers, dead letters) and stored the instance; `send` awaits it,
   * because pg-boss 12 throws when sending to a queue that does not exist yet. It rejects when startup fails (or the
   * service is destroyed first), so a waiting `send` fails instead of hanging. Null while jobs are disabled.
   */
  private readonly ready: Promise<void> | null;
  private settleReady: { resolve: () => void; reject: (err: unknown) => void } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ops: OccurrenceJobs,
  ) {
    if (config.JOBS_ENABLED) {
      this.ready = new Promise<void>((resolve, reject) => {
        this.settleReady = { resolve, reject };
      });
      // Nobody may be waiting on it (nothing sent), which must not count as an unhandled rejection.
      this.ready.catch(() => undefined);
    } else {
      this.ready = null;
    }
  }

  /** Called from another provider's onModuleInit, which Nest runs before onApplicationBootstrap starts the workers. */
  define(def: JobDefinition): void {
    if (this.boss) throw new Error(`Job ${def.name} must be defined before the application starts`);
    this.defined.push(def);
  }

  /** A queue many jobs flow through (e.g. notifications.fanout), as opposed to a stately cron. Define it in onModuleInit. */
  defineWorker<T extends object>(name: string, handler: (data: T) => Promise<void>, opts: WorkerOptions): void {
    if (this.boss) throw new Error(`Worker ${name} must be defined before the application starts`);
    this.workers.push({ name, handler: handler as (data: object) => Promise<void>, opts });
  }

  /**
   * Queues one job. While background jobs are disabled (tests, JOBS_ENABLED=false) it returns false at once and
   * waits for nothing. Otherwise it waits for startup to finish creating the queues; if startup failed it rejects
   * with that error (it never hangs), and after shutdown it returns false.
   */
  async send(queue: string, data: object): Promise<boolean> {
    if (!this.ready) return false;
    await this.ready;
    if (!this.boss) return false;
    await this.boss.send(queue, data);
    return true;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.JOBS_ENABLED) return;
    try {
      await this.startBoss();
      this.settleReady?.resolve();
    } catch (err) {
      this.settleReady?.reject(err);
      throw err;
    }
  }

  private async startBoss(): Promise<void> {
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
    for (const def of this.defined) {
      await this.ensureQueue(boss, def.name, { policy: 'stately', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
      await boss.work<JobData>(def.name, async ([job]) => {
        await def.handler(job?.data?.tenantIds);
      });
    }
    const deadLetters = [...new Set(this.workers.map((w) => w.opts.deadLetter))].filter((q) => q !== QUEUES.dead);
    for (const dl of deadLetters) await this.ensureQueue(boss, dl);
    for (const w of this.workers) {
      // standard: any number of queued jobs, each retried with backoff and then dead-lettered.
      await this.ensureQueue(boss, w.name, {
        policy: 'standard',
        retryLimit: w.opts.retryLimit,
        retryBackoff: true,
        ...(w.opts.retryDelay !== undefined && { retryDelay: w.opts.retryDelay }),
        ...(w.opts.retryDelayMax !== undefined && { retryDelayMax: w.opts.retryDelayMax }),
        ...(w.opts.expireInSeconds !== undefined && { expireInSeconds: w.opts.expireInSeconds }),
        deadLetter: w.opts.deadLetter,
      });
      // batchSize stays 1: the handler takes one job, so a larger batch would complete the others unprocessed.
      const work = {
        ...(w.opts.pollingIntervalSeconds !== undefined && { pollingIntervalSeconds: w.opts.pollingIntervalSeconds }),
        ...(w.opts.localConcurrency !== undefined && { localConcurrency: w.opts.localConcurrency }),
      };
      await boss.work<object>(w.name, work, async ([job]) => {
        if (job) await w.handler(job.data);
      });
    }
    await boss.work(QUEUES.dead, async (jobs) => {
      for (const j of jobs) this.logger.error(`Job ${j.name} (${j.id}) failed after all retries`);
    });
    for (const dl of deadLetters) {
      const onDead = this.workers.filter((w) => w.opts.deadLetter === dl && w.opts.onDead).map((w) => w.opts.onDead!);
      await boss.work<object>(dl, async (jobs) => {
        for (const j of jobs) {
          this.logger.error(`Job ${j.id} reached ${dl} after all retries: ${JSON.stringify(j.data)}`);
          for (const handle of onDead) await handle(j.data);
        }
      });
    }
    if (this.config.JOBS_CRON) {
      await boss.schedule(QUEUES.materialize, '*/15 * * * *', null, { tz: 'UTC', missed: 'once' });
      await boss.schedule(QUEUES.sweep, '* * * * *', null, { tz: 'UTC', missed: 'once' });
      for (const def of this.defined) await boss.schedule(def.name, def.cron, null, { tz: 'UTC', missed: 'once' });
      // A freshly started API catches up at once instead of waiting for the next quarter hour.
      await boss.send(QUEUES.materialize, {});
    } else {
      for (const name of [QUEUES.materialize, QUEUES.sweep, ...this.defined.map((d) => d.name)]) {
        // Drops schedules left by an earlier run with cron on; there may be none.
        await boss.unschedule(name).catch(() => undefined);
      }
    }
    this.boss = boss;
  }

  async onModuleDestroy(): Promise<void> {
    // A send still waiting for a startup that never finished must not hang (no effect once ready has settled).
    this.settleReady?.reject(new Error('Background jobs shut down before they finished starting'));
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
    this.boss = null;
  }

  /** Queues a run now; `tenantIds` limits it to those tenants. */
  async runNow(queue: string, tenantIds?: string[]): Promise<void> {
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

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { FINAL_TASK_STATUSES } from '@taskop/contracts';
import { and, asc, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { perTenant, tenantsWith } from '../common/per-tenant';
import { DbService } from '../db/db.service';
import { taskMedia, tasks } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { purgeStalePending } from '../storage/purge-pending-media';
import { S3Service } from '../storage/s3.service';
import { TaskWriter } from './task-writer';

export const TASK_SWEEP_QUEUE = 'tasks.sweep';
export const TASK_MEDIA_CLEANUP_QUEUE = 'task-media.cleanup';

/** The task cron jobs (spec §6.5). One RLS transaction per tenant. */
@Injectable()
export class TaskJobs implements OnModuleInit {
  private readonly logger = new Logger('TaskJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly writer: TaskWriter,
    private readonly s3: S3Service,
  ) {}

  onModuleInit(): void {
    this.jobs.define({ name: TASK_SWEEP_QUEUE, cron: '* * * * *', handler: (tenantIds) => this.sweepAll(tenantIds) });
    // 03:45 UTC = 07:45 in Baku, after media.cleanup and before the working day.
    this.jobs.define({ name: TASK_MEDIA_CLEANUP_QUEUE, cron: '45 3 * * *', handler: (tenantIds) => this.cleanupAll(tenantIds) });
  }

  /** tasks.sweep: overdue_at = now on open tasks with now ≥ due_at, once; rev bumped; task.overdue per task. */
  async sweepAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const tenantIds = await tenantsWith(
      this.db,
      sql`select distinct tenant_id from tasks where status not in (${sql.join(FINAL_TASK_STATUSES.map((s) => sql`${s}`), sql`, `)}) and overdue_at is null and due_at <= ${now}`,
      only,
    );
    return perTenant(this.db, this.logger, 'Task sweep', tenantIds, () => this.sweepTenant(now));
  }

  /** SKIP LOCKED: a task held by a running command is flagged on the next run, never waited for. */
  private async sweepTenant(now: Date): Promise<number> {
    const tx = this.db.tx();
    const due = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(notInArray(tasks.status, [...FINAL_TASK_STATUSES]), isNull(tasks.overdueAt), lte(tasks.dueAt, now)))
      .orderBy(asc(tasks.id))
      .for('update', { skipLocked: true });
    const flagged = await tx
      .update(tasks)
      .set({ overdueAt: now, rev: sql`${tasks.rev} + 1`, updatedAt: now })
      .where(and(inArray(tasks.id, due), isNull(tasks.overdueAt)))
      .returning();
    for (const t of flagged) await this.writer.emit('task.overdue', t, null);
    return flagged.length;
  }

  /** task-media.cleanup (spec §6.5, Decision 3): deletes objects of media still pending after 14 days; rows stay. */
  cleanupAll(only?: string[]): Promise<number> {
    return purgeStalePending({ db: this.db, clock: this.clock, s3: this.s3, logger: this.logger }, taskMedia, taskMedia.taskId, 'Task media cleanup', only);
  }
}

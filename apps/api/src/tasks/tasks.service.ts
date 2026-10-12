import { Injectable } from '@nestjs/common';
import type { TaskDetail } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { sites, tasks } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { CreateTaskDto } from './dto';
import { TaskAssignees } from './task-assignees';
import { TaskQueries } from './task-queries';
import { auditView } from './task-rows';
import { TaskWriter } from './task-writer';

/** Manager commands (spec §6.2). Each runs in the request's tenant transaction. */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly siteScope: SchedulingScope,
    private readonly assignees: TaskAssignees,
    private readonly writer: TaskWriter,
    private readonly queries: TaskQueries,
  ) {}

  /** POST /tasks. Idempotent on the client id: a repeat returns the stored task unchanged (the body is not compared). */
  async create(p: Principal, dto: CreateTaskDto): Promise<TaskDetail> {
    const tx = this.db.tx();
    const [known] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, dto.id));
    if (known) return this.queries.detail(p, dto.id);
    const now = this.clock.now();
    if (dto.siteId) await this.assertSite(p, dto.siteId);
    const assignee = await this.assignees.resolve(p, dto.assignee);
    const [row] = await tx
      .insert(tasks)
      .values({
        id: dto.id,
        tenantId: p.tenantId,
        title: dto.title,
        instructions: dto.instructions,
        priority: dto.priority,
        siteId: dto.siteId,
        createdByUserId: p.userId,
        assigneeUserId: assignee.userId,
        assigneeTeamId: assignee.teamId,
        requiresReview: dto.requiresReview ?? false,
        evidence: dto.evidence,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.writer.history(row!, [{ from: null, to: 'new', at: now, actorUserId: p.userId }]);
    await this.writer.record('task.created', row!.id, { after: auditView(row!) });
    await this.writer.emit('task.assigned', row!, p.userId);
    return this.queries.detail(p, row!.id);
  }

  /** Spec Decision 19: the site exists, is active and lies within the caller's scope. */
  private async assertSite(p: Principal, siteId: string): Promise<void> {
    const [site] = await this.db.tx().select({ active: sites.active }).from(sites).where(eq(sites.id, siteId));
    if (!site) throw new AppError('REFERENCE_NOT_FOUND', { fields: { siteId: 'errors.REFERENCE_NOT_FOUND' } });
    if (!site.active) throw new AppError('SITE_INACTIVE');
    await this.siteScope.assertSiteWritable(p, siteId);
  }
}

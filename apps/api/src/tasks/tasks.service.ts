import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import { isFinalTaskStatus, type TaskDetail, taskTransition } from '@taskop/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { sites, tasks, taskSubmissions } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { CancelTaskDto, CreateTaskDto, ReviewTaskDto, UpdateTaskDto } from './dto';
import { TaskAssignees } from './task-assignees';
import { TaskProblems } from './task-problems';
import { TaskQueries } from './task-queries';
import { auditView } from './task-rows';
import { TaskScope } from './task-scope';
import { TaskWriter } from './task-writer';

/** Manager commands (spec §6.2). Each runs in the request's tenant transaction. */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly siteScope: SchedulingScope,
    private readonly assignees: TaskAssignees,
    private readonly problems: TaskProblems,
    private readonly writer: TaskWriter,
    private readonly queries: TaskQueries,
    private readonly scope: TaskScope,
  ) {}

  /** POST /tasks. Idempotent on the client id: a repeat returns the stored task unchanged (the body is not compared). */
  async create(p: Principal, dto: CreateTaskDto): Promise<TaskDetail> {
    const tx = this.db.tx();
    const [known] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, dto.id));
    if (known) return this.queries.detail(p, dto.id);
    const now = this.clock.now();
    let siteId = dto.siteId;
    if (dto.problemId) {
      const problem = await this.problems.readable(p, dto.problemId);
      if (!problem) throw new AppError('NOT_FOUND');
      // Only problems of closed runs: their rows no longer change (spec §1).
      if (problem.executionState !== 'completed' && problem.executionState !== 'partial') throw new AppError('PROBLEM_NOT_CLOSED');
      // Ruling F3: a problem a correction cleared is no longer open, so no remediation task starts from it.
      if (problem.pr.clearedAt !== null) throw new AppError('PROBLEM_NOT_CLOSED');
      if (problem.taskId) throw new AppError('PROBLEM_ALREADY_HAS_TASK');
      siteId = problem.pr.siteId;
    } else if (siteId) {
      await this.assertSite(p, siteId);
    }
    const assignee = await this.assignees.resolve(p, dto.assignee);
    const [row] = await tx
      .insert(tasks)
      .values({
        id: dto.id,
        tenantId: p.tenantId,
        title: dto.title,
        instructions: dto.instructions,
        priority: dto.priority,
        siteId,
        createdByUserId: p.userId,
        assigneeUserId: assignee.userId,
        assigneeTeamId: assignee.teamId,
        // Problem fixes are reviewed unless the creator says otherwise (spec §1).
        requiresReview: dto.requiresReview ?? dto.problemId !== null,
        evidence: dto.evidence,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        problemId: dto.problemId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.writer.history(row!, [{ from: null, to: 'new', at: now, actorUserId: p.userId }]);
    await this.writer.record('task.created', row!.id, { after: auditView(row!) });
    await this.writer.emit('task.assigned', row!, p.userId);
    return this.queries.detail(p, row!.id);
  }

  /**
   * PATCH /tasks/:id. Only fields that differ from the locked row change; a PATCH that changes nothing writes nothing.
   * An assignee change reassigns (spec §3): task.reassigned; other edits: task.updated.
   */
  async update(p: Principal, id: string, dto: UpdateTaskDto): Promise<TaskDetail> {
    const now = this.clock.now();
    const t = await this.scope.lock(id);
    await this.scope.assertManage(p, t);
    if (isFinalTaskStatus(t.status)) throw new AppError('TASK_STATE_INVALID');
    const set: Partial<typeof tasks.$inferInsert> = {};
    if (dto.title !== undefined && dto.title !== t.title) set.title = dto.title;
    if (dto.instructions !== undefined && dto.instructions !== t.instructions) set.instructions = dto.instructions;
    if (dto.priority !== undefined && dto.priority !== t.priority) set.priority = dto.priority;
    if (dto.evidence !== undefined && !isDeepStrictEqual(dto.evidence, t.evidence)) set.evidence = dto.evidence;
    if (dto.requiresReview !== undefined && dto.requiresReview !== t.requiresReview) set.requiresReview = dto.requiresReview;
    if (dto.siteId !== undefined && dto.siteId !== t.siteId) {
      if (dto.siteId) await this.assertSite(p, dto.siteId);
      set.siteId = dto.siteId;
    }
    if (dto.dueAt !== undefined) {
      const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
      if (dueAt?.getTime() !== t.dueAt?.getTime()) {
        set.dueAt = dueAt;
        // Spec Decision 11: no longer due → the flag goes. Completion never clears it.
        if (t.overdueAt && (dueAt === null || dueAt > now)) set.overdueAt = null;
      }
    }
    const edited = Object.keys(set).length > 0;
    let reassigned = false;
    if (dto.assignee) {
      const a = dto.assignee;
      // Spec Decision 21: the same person (no team) or the same team (nobody accepted) is not a change. Checked on the
      // request, before resolve, so re-sending a deactivated assignee alongside other edits still works.
      const same = 'userId' in a ? t.assigneeUserId === a.userId && t.assigneeTeamId === null : t.assigneeTeamId === a.teamId && t.assigneeUserId === null;
      if (!same) {
        const next = await this.assignees.resolve(p, a);
        reassigned = true;
        set.assigneeUserId = next.userId;
        set.assigneeTeamId = next.teamId;
        set.status = 'new';
        set.acceptedAt = null;
        set.startedAt = null;
      }
    }
    if (!edited && !reassigned) return this.queries.detail(p, id, { afterManage: true });
    const [row] = await this.db
      .tx()
      .update(tasks)
      .set({ ...set, rev: sql`${tasks.rev} + 1`, updatedAt: now })
      .where(eq(tasks.id, id))
      .returning();
    if (edited) await this.writer.record('task.updated', id, { before: auditView(t), after: auditView(row!) });
    if (reassigned) {
      // Earlier submissions stay; the history shows the reset.
      if (t.status !== 'new') await this.writer.history(t, [{ from: t.status, to: 'new', at: now, actorUserId: p.userId }]);
      await this.writer.record('task.reassigned', id, {
        before: { assigneeUserId: t.assigneeUserId, assigneeTeamId: t.assigneeTeamId, status: t.status },
        after: { assigneeUserId: row!.assigneeUserId, assigneeTeamId: row!.assigneeTeamId, status: row!.status },
      });
      await this.writer.emit('task.assigned', row!, p.userId);
    }
    return this.queries.detail(p, id, { afterManage: true });
  }

  /** POST /tasks/:id/cancel: from any open status, with a reason. */
  async cancel(p: Principal, id: string, dto: CancelTaskDto): Promise<TaskDetail> {
    const now = this.clock.now();
    const t = await this.scope.lock(id);
    await this.scope.assertManage(p, t);
    if (!taskTransition(t.status, 'cancel', t)) throw new AppError('TASK_STATE_INVALID');
    const [row] = await this.db
      .tx()
      .update(tasks)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: dto.reason, rev: sql`${tasks.rev} + 1`, updatedAt: now })
      .where(eq(tasks.id, id))
      .returning();
    await this.writer.history(t, [{ from: t.status, to: 'cancelled', at: now, actorUserId: p.userId, comment: dto.reason }]);
    await this.writer.record('task.cancelled', id, { before: { status: t.status }, after: { status: 'cancelled', reason: dto.reason } });
    await this.writer.emit('task.cancelled', row!, p.userId);
    return this.queries.detail(p, id, { afterManage: true });
  }

  /** POST /tasks/:id/review: the creator or a manager; only from awaiting_review; the latest submission gets the review. */
  async review(p: Principal, id: string, dto: ReviewTaskDto): Promise<TaskDetail> {
    const now = this.clock.now();
    const tx = this.db.tx();
    const t = await this.scope.lock(id);
    const access = await this.scope.access(p, id);
    if (!access.canRead) throw new AppError('NOT_FOUND');
    if (!access.canReview) throw new AppError('FORBIDDEN');
    const next = taskTransition(t.status, dto.decision, t);
    if (!next) throw new AppError('TASK_STATE_INVALID');
    const [latest] = await tx
      .select({ id: taskSubmissions.id })
      .from(taskSubmissions)
      .where(eq(taskSubmissions.taskId, id))
      .orderBy(desc(taskSubmissions.receivedAt), desc(taskSubmissions.id))
      .limit(1);
    if (!latest) throw new AppError('TASK_STATE_INVALID');
    const approved = dto.decision === 'approve';
    const comment = dto.comment || null;
    await tx
      .update(taskSubmissions)
      .set({ reviewDecision: approved ? 'approved' : 'rejected', reviewComment: comment, reviewedByUserId: p.userId, reviewedAt: now })
      .where(eq(taskSubmissions.id, latest.id));
    const [row] = await tx
      .update(tasks)
      .set({ status: next, ...(approved ? { completedAt: now } : {}), rev: sql`${tasks.rev} + 1`, updatedAt: now })
      .where(eq(tasks.id, id))
      .returning();
    await this.writer.history(t, [{ from: t.status, to: next, at: now, actorUserId: p.userId, comment }]);
    await this.writer.record(approved ? 'task.approved' : 'task.rejected', id, { after: { submissionId: latest.id, comment } });
    await this.writer.emit(approved ? 'task.completed' : 'task.rejected', row!, p.userId);
    return this.queries.detail(p, id, { afterManage: true });
  }

  /** Spec Decision 19: the site exists, is active and lies within the caller's scope. */
  private async assertSite(p: Principal, siteId: string): Promise<void> {
    const [site] = await this.db.tx().select({ active: sites.active }).from(sites).where(eq(sites.id, siteId));
    if (!site) throw new AppError('REFERENCE_NOT_FOUND', { fields: { siteId: 'errors.REFERENCE_NOT_FOUND' } });
    if (!site.active) throw new AppError('SITE_INACTIVE');
    await this.siteScope.assertSiteWritable(p, siteId);
  }
}

import { Injectable } from '@nestjs/common';
import { type MediaKind, TASK_LIMITS, type TaskDetail, type TaskEvidence, type TaskStatus, taskEvidenceMet, taskTransition } from '@taskop/contracts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { taskMedia, tasks, taskSubmissions } from '../db/schema';
import type { SubmissionDto, TaskActionCommandDto } from './dto';
import { TaskQueries } from './task-queries';
import { type TaskRow, TaskScope } from './task-scope';
import { boundTaskTime } from './task-time';
import { TaskWriter } from './task-writer';

/** After `start`, repeated accepts and starts by the assignee are replays. */
const STARTED: readonly TaskStatus[] = ['in_progress', 'awaiting_review', 'completed'];

/**
 * The worker's commands (spec §6.2): accept, start, submit. Each locks the task row first, so two accepts
 * of one team task are serialised and the first to reach the server wins. Every command is idempotent.
 */
@Injectable()
export class TaskWorkService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly scope: TaskScope,
    private readonly writer: TaskWriter,
    private readonly queries: TaskQueries,
  ) {}

  /** POST /tasks/:id/accept. */
  async accept(p: Principal, id: string, cmd: TaskActionCommandDto): Promise<TaskDetail> {
    const receivedAt = this.clock.now();
    const t = await this.scope.lock(id);
    await this.scope.assertWorker(p, t);
    if (t.assigneeUserId === p.userId && t.status !== 'new') return this.replayed(p, t);
    if (!taskTransition(t.status, 'accept', t)) throw new AppError('TASK_STATE_INVALID');
    await this.markAccepted(p, t, boundTaskTime(new Date(cmd.at), t.createdAt, receivedAt), receivedAt);
    return this.queries.detail(p, id);
  }

  /** POST /tasks/:id/start. On a new task it accepts first, at the same time: two history rows (spec §3). */
  async start(p: Principal, id: string, cmd: TaskActionCommandDto): Promise<TaskDetail> {
    const receivedAt = this.clock.now();
    const t = await this.scope.lock(id);
    await this.scope.assertWorker(p, t);
    if (t.assigneeUserId === p.userId && STARTED.includes(t.status)) return this.replayed(p, t);
    if (!taskTransition(t.status, 'start', t)) throw new AppError('TASK_STATE_INVALID');
    const at = boundTaskTime(new Date(cmd.at), t.acceptedAt ?? t.createdAt, receivedAt);
    if (t.status === 'new') await this.markAccepted(p, t, at, receivedAt);
    await this.db
      .tx()
      .update(tasks)
      .set({ status: 'in_progress', startedAt: at, rev: sql`${tasks.rev} + 1`, updatedAt: receivedAt })
      .where(eq(tasks.id, id));
    await this.writer.history(t, [{ from: 'accepted', to: 'in_progress', at, actorUserId: p.userId }]);
    return this.queries.detail(p, id);
  }

  /**
   * POST /tasks/:id/submissions. Idempotent on the submission id, whatever the status now (spec Decision 9).
   * Checks the status, the listed media and the evidence rules, links the media, and completes or sends to review.
   */
  async submit(p: Principal, id: string, cmd: SubmissionDto): Promise<TaskDetail> {
    const receivedAt = this.clock.now();
    const tx = this.db.tx();
    const t = await this.scope.lock(id);
    await this.scope.assertWorker(p, t);
    const [known] = await tx.select({ taskId: taskSubmissions.taskId }).from(taskSubmissions).where(eq(taskSubmissions.id, cmd.id));
    if (known) {
      if (known.taskId !== id) throw new AppError('NOT_FOUND');
      return this.queries.detail(p, id);
    }
    // An unaccepted team task is refused: someone must accept and start it first.
    if (t.assigneeUserId !== p.userId) throw new AppError('TASK_STATE_INVALID');
    const next = taskTransition(t.status, 'submit', t);
    if (!next) throw new AppError('TASK_STATE_INVALID');
    const media = await this.responseMedia(p, id, cmd.mediaIds);
    const evidence = taskEvidenceMet(t.evidence as TaskEvidence, media);
    if (!evidence.ok) {
      throw new AppError('EVIDENCE_REQUIRED', { fields: Object.fromEntries(evidence.missing.map((k) => [`evidence.${k}`, `tasks.issues.${k}Required`])) });
    }
    const at = boundTaskTime(new Date(cmd.submittedAt), t.startedAt ?? t.createdAt, receivedAt);
    await tx.insert(taskSubmissions).values({
      id: cmd.id,
      tenantId: p.tenantId,
      taskId: id,
      submittedByUserId: p.userId,
      text: cmd.text,
      mediaIds: cmd.mediaIds,
      submittedAt: at,
      receivedAt,
    });
    if (cmd.mediaIds.length) await tx.update(taskMedia).set({ submissionId: cmd.id }).where(inArray(taskMedia.id, cmd.mediaIds));
    const [row] = await tx
      .update(tasks)
      .set({ status: next, submittedAt: at, completedAt: next === 'completed' ? at : null, rev: sql`${tasks.rev} + 1`, updatedAt: receivedAt })
      .where(eq(tasks.id, id))
      .returning();
    await this.writer.history(t, [{ from: t.status, to: next, at, actorUserId: p.userId }]);
    await this.writer.emit('task.submitted', row!, p.userId);
    if (next === 'completed') await this.writer.emit('task.completed', row!, p.userId);
    return this.queries.detail(p, id);
  }

  /**
   * The listed media (spec Decision 12): distinct, response media of this task, captured by the caller and not used
   * by an earlier submission; at most 10 photos and 3 videos.
   */
  private async responseMedia(p: Principal, taskId: string, ids: string[]): Promise<Array<{ id: string; kind: MediaKind }>> {
    const unknown = () => new AppError('VALIDATION_FAILED', { fields: { mediaIds: 'tasks.issues.unknownMedia' } });
    if (new Set(ids).size !== ids.length) throw unknown();
    const rows = ids.length
      ? await this.db
          .tx()
          .select({ id: taskMedia.id, kind: taskMedia.kind })
          .from(taskMedia)
          .where(
            and(
              inArray(taskMedia.id, ids),
              eq(taskMedia.taskId, taskId),
              eq(taskMedia.role, 'response'),
              eq(taskMedia.capturedByUserId, p.userId),
              isNull(taskMedia.submissionId),
            ),
          )
      : [];
    if (rows.length !== ids.length) throw unknown();
    const photos = rows.filter((r) => r.kind === 'photo').length;
    if (photos > TASK_LIMITS.responsePhotos || rows.length - photos > TASK_LIMITS.responseVideos) {
      throw new AppError('VALIDATION_FAILED', { fields: { mediaIds: 'tasks.issues.tooManyMedia' } });
    }
    return rows;
  }

  /** A command repeated by the assignee after the task moved past it changes nothing; nothing leaves cancelled. */
  private async replayed(p: Principal, t: TaskRow): Promise<TaskDetail> {
    if (t.status === 'cancelled') throw new AppError('TASK_STATE_INVALID');
    return this.queries.detail(p, t.id);
  }

  /** new → accepted; for a team task the caller becomes the assignee. */
  private async markAccepted(p: Principal, t: TaskRow, at: Date, receivedAt: Date): Promise<void> {
    const [row] = await this.db
      .tx()
      .update(tasks)
      .set({ assigneeUserId: p.userId, status: 'accepted', acceptedAt: at, rev: sql`${tasks.rev} + 1`, updatedAt: receivedAt })
      .where(eq(tasks.id, t.id))
      .returning();
    await this.writer.history(t, [{ from: 'new', to: 'accepted', at, actorUserId: p.userId }]);
    await this.writer.emit('task.accepted', row!, p.userId);
  }
}

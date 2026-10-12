import { Injectable } from '@nestjs/common';
import { type TaskDetail, type TaskStatus, taskTransition } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { tasks } from '../db/schema';
import type { TaskActionCommandDto } from './dto';
import { TaskQueries } from './task-queries';
import { type TaskRow, TaskScope } from './task-scope';
import { boundTaskTime } from './task-time';
import { TaskWriter } from './task-writer';

/** After `start`, repeated accepts and starts by the assignee are replays. */
const STARTED: readonly TaskStatus[] = ['in_progress', 'awaiting_review', 'completed'];

/**
 * The worker's commands (spec §6.2): accept, start (submit comes later). Each locks the task row first, so two accepts
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

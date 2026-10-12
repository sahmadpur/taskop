import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FINAL_TASK_STATUSES, type TaskHistoryReason } from '@taskop/contracts';
import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { tasks, users } from '../db/schema';
import { TaskWriter } from './task-writer';

const DEACTIVATED: TaskHistoryReason = 'assignee_deactivated';

/** Keeps tasks in step with user changes (spec §6.5). Handlers run in the caller's transaction. */
@Injectable()
export class TaskListeners implements OnModuleInit {
  constructor(
    private readonly events: DomainEvents,
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: TaskWriter,
  ) {}

  onModuleInit(): void {
    this.events.on('user.access_changed', (e) => this.onUserAccessChanged(e.userId));
  }

  /**
   * Deactivation: open team tasks the user accepted go back to the team. Direct tasks stay as they are (the API
   * reports assigneeInactive so a manager reassigns). Nothing is deleted (FR-04.11). Reactivation changes nothing.
   */
  private async onUserAccessChanged(userId: string): Promise<void> {
    const tx = this.db.tx();
    const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (u?.status !== 'deactivated') return;
    // In id order, so this never deadlocks with other changes that lock several tasks.
    const taken = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.assigneeUserId, userId), isNotNull(tasks.assigneeTeamId), notInArray(tasks.status, [...FINAL_TASK_STATUSES])))
      .orderBy(asc(tasks.id))
      .for('update');
    const now = this.clock.now();
    for (const t of taken) {
      const [row] = await tx
        .update(tasks)
        .set({ assigneeUserId: null, status: 'new', acceptedAt: null, startedAt: null, rev: sql`${tasks.rev} + 1`, updatedAt: now })
        .where(eq(tasks.id, t.id))
        .returning();
      await this.writer.history(t, [{ from: t.status, to: 'new', at: now, actorUserId: null, comment: DEACTIVATED }]);
      await this.writer.emit('task.assigned', row!, null);
    }
  }
}

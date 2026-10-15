import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationType, OccurrenceStatus } from '@taskop/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainEvents, type TaskEvent, type TaskEventName } from '../common/domain-events';
import { sanitiseForLog } from '../common/error.filter';
import { DbService, type Tx } from '../db/db.service';
import { pushDevices, tasks, users } from '../db/schema';
import { NotificationEvents } from './notification-events';

/** task.* events that become notifications of the same name (spec §6.1 step 2). task.accepted is not notified. */
const TASK_TYPES = ['task.assigned', 'task.rejected', 'task.completed', 'task.overdue', 'task.cancelled'] as const satisfies readonly (TaskEventName & NotificationType)[];

/** The occurrence statuses that become notifications. */
function isNotifiedStatus(status: OccurrenceStatus): status is 'overdue' | 'missed' {
  return status === 'overdue' || status === 'missed';
}

/** Maps domain events to notification events. Handlers run in the caller's transaction and never throw (NFR-11.01). */
@Injectable()
export class NotificationListeners implements OnModuleInit {
  private readonly logger = new Logger('NotificationListeners');

  constructor(
    private readonly events: DomainEvents,
    private readonly db: DbService,
    private readonly notifications: NotificationEvents,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.events.on('occurrence.status_changed', (e) => {
      // Most status changes are not notified; skip the savepoint round-trip for them.
      const to = e.to;
      if (!isNotifiedStatus(to)) return Promise.resolve();
      return this.guarded('occurrence.status_changed', () => this.onOccurrence(e.occurrenceId, to));
    });
    this.events.on('assignment.assignees_changed', (e) =>
      this.guarded('assignment.assignees_changed', () => this.notifications.record('checklist.assigned', { assignmentId: e.assignmentId, addedUserIds: e.addedUserIds }, e.actorUserId)),
    );
    this.events.on('problem.recorded', (e) =>
      this.guarded('problem.recorded', () =>
        this.notifications.record(e.severity === 'critical' ? 'problem.critical' : 'problem.recorded', { problemId: e.problemId, occurrenceId: e.occurrenceId }, e.actorUserId, `problem:${e.problemId}`),
      ),
    );
    for (const name of TASK_TYPES) this.events.on(name, (e) => this.guarded(name, () => this.notifications.record(name, { taskId: e.taskId }, e.actorUserId)));
    this.events.on('task.submitted', (e) => this.guarded('task.submitted', (sp) => this.onSubmitted(sp, e)));
    // SP8 spec §7.1. Dedupe keys make a replayed command's second event a no-op.
    this.events.on('execution.sent_back', (e) =>
      this.guarded('execution.sent_back', () =>
        this.notifications.record('run.correction_required', { occurrenceId: e.occurrenceId, executionId: e.executionId, round: e.round }, e.actorUserId, `run.correction_required:${e.executionId}:${e.round}`),
      ),
    );
    this.events.on('execution.resubmitted', (e) =>
      this.guarded('execution.resubmitted', () =>
        this.notifications.record('run.resubmitted', { occurrenceId: e.occurrenceId, executionId: e.executionId, round: e.round }, e.actorUserId, `run.resubmitted:${e.executionId}:${e.round}`),
      ),
    );
    this.events.on('audit.finished', (e) =>
      this.guarded('audit.finished', () =>
        this.notifications.record('audit.finished', { occurrenceId: e.occurrenceId, executionId: e.executionId, auditId: e.auditId }, e.actorUserId, `audit.finished:${e.auditId}`),
      ),
    );
    this.events.on('user.access_changed', (e) => this.guarded('user.access_changed', (sp) => this.onAccessChanged(sp, e.userId)));
  }

  /**
   * Runs a handler body in a savepoint and swallows its failure: whatever goes wrong here (a read as much as the insert)
   * must never roll back the business change (NFR-11.01).
   */
  private async guarded(event: string, body: (sp: Tx) => Promise<unknown>): Promise<void> {
    try {
      await this.db.tx().transaction((sp) => body(sp));
    } catch (e) {
      this.logger.error(sanitiseForLog(e, null), `Notification listener for ${event} failed; the business change still commits`);
    }
  }

  /** The sweep has no user, so its overdue and missed events have no actor (Spec decision 5). */
  private async onOccurrence(occurrenceId: string, to: 'overdue' | 'missed'): Promise<void> {
    const type = to === 'overdue' ? 'checklist.overdue' : 'checklist.missed';
    await this.notifications.record(type, { occurrenceId }, this.db.context().userId, `${type}:${occurrenceId}`);
  }

  /** Spec decision 23: only a submission that waits for review is "submitted"; one straight to completed is told as completed. */
  private async onSubmitted(sp: Tx, e: TaskEvent): Promise<void> {
    const [t] = await sp.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, e.taskId));
    if (t?.status !== 'awaiting_review') return;
    await this.notifications.record('task.submitted', { taskId: e.taskId }, e.actorUserId);
  }

  /**
   * Spec §6.5: a deactivated user's phones stop receiving pushes. Reactivation re-enables nothing; the phone
   * re-registers. Guarded like every handler here, so it can never roll back the deactivation.
   */
  private async onAccessChanged(sp: Tx, userId: string): Promise<void> {
    const [u] = await sp.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (u?.status !== 'deactivated') return;
    await sp
      .update(pushDevices)
      .set({ disabledAt: this.clock.now() })
      .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.disabledAt)));
  }
}

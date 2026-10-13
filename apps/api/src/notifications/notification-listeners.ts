import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationType, OccurrenceStatus } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { DomainEvents, type TaskEvent, type TaskEventName } from '../common/domain-events';
import { sanitiseForLog } from '../common/error.filter';
import { DbService, type Tx } from '../db/db.service';
import { tasks } from '../db/schema';
import { NotificationEvents } from './notification-events';

/** task.* events that become notifications of the same name (spec §6.1 step 2). task.accepted is not notified. */
const TASK_TYPES = ['task.assigned', 'task.rejected', 'task.completed', 'task.overdue', 'task.cancelled'] as const satisfies readonly (TaskEventName & NotificationType)[];

/** Maps domain events to notification events. Handlers run in the caller's transaction and never throw (NFR-11.01). */
@Injectable()
export class NotificationListeners implements OnModuleInit {
  private readonly logger = new Logger('NotificationListeners');

  constructor(
    private readonly events: DomainEvents,
    private readonly db: DbService,
    private readonly notifications: NotificationEvents,
  ) {}

  onModuleInit(): void {
    this.events.on('occurrence.status_changed', (e) => this.guarded('occurrence.status_changed', () => this.onOccurrence(e.occurrenceId, e.to)));
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
  private async onOccurrence(occurrenceId: string, to: OccurrenceStatus): Promise<void> {
    if (to !== 'overdue' && to !== 'missed') return;
    const type = to === 'overdue' ? 'checklist.overdue' : 'checklist.missed';
    await this.notifications.record(type, { occurrenceId }, this.db.context().userId, `${type}:${occurrenceId}`);
  }

  /** Spec decision 23: only a submission that waits for review is "submitted"; one straight to completed is told as completed. */
  private async onSubmitted(sp: Tx, e: TaskEvent): Promise<void> {
    const [t] = await sp.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, e.taskId));
    if (t?.status !== 'awaiting_review') return;
    await this.notifications.record('task.submitted', { taskId: e.taskId }, e.actorUserId);
  }
}

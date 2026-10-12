import { Injectable } from '@nestjs/common';
import type { TaskAuditAction, TaskStatus } from '@taskop/contracts';
import { DomainEvents, type TaskEventName } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { taskStatusHistory } from '../db/schema';
import type { TaskRow } from './task-scope';

export interface HistoryStep {
  from: TaskStatus | null;
  to: TaskStatus;
  at: Date;
  /** Null for the system. */
  actorUserId: string | null;
  comment?: string | null;
}

/** History rows, audit entries and task.* events, in the caller's transaction. */
@Injectable()
export class TaskWriter {
  constructor(
    private readonly db: DbService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  /** An audit entry for a task, typed by TaskAuditAction. */
  async record(action: TaskAuditAction, taskId: string, change: { before?: unknown; after?: unknown }): Promise<void> {
    await this.audit.record({ action, entityType: 'task', entityId: taskId, ...change });
  }

  async history(t: Pick<TaskRow, 'id' | 'tenantId'>, steps: HistoryStep[]): Promise<void> {
    if (!steps.length) return;
    await this.db
      .tx()
      .insert(taskStatusHistory)
      .values(steps.map((s) => ({ tenantId: t.tenantId, taskId: t.id, fromStatus: s.from, toStatus: s.to, at: s.at, actorUserId: s.actorUserId, comment: s.comment ?? null })));
  }

  /** `t` is the task after the change, so the payload names the current assignee. */
  async emit(name: TaskEventName, t: Pick<TaskRow, 'id' | 'tenantId' | 'assigneeUserId' | 'assigneeTeamId' | 'createdByUserId'>, actorUserId: string | null): Promise<void> {
    await this.events.emit(name, {
      tenantId: t.tenantId,
      taskId: t.id,
      actorUserId,
      assigneeUserId: t.assigneeUserId,
      assigneeTeamId: t.assigneeTeamId,
      createdByUserId: t.createdByUserId,
    });
  }
}

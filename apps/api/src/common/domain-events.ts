import { Injectable } from '@nestjs/common';
import type { OccurrenceStatus } from '@taskop/contracts';

/** Payload of every task.* event (SP5 spec §6.5). SP6 listens for notifications; SP5 has no listeners. */
export interface TaskEvent {
  tenantId: string;
  taskId: string;
  /** Null for the system (sweep, deactivation listener). */
  actorUserId: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  createdByUserId: string;
}

export interface DomainEventMap {
  'user.access_changed': { tenantId: string; userId: string };
  'checklist.deactivated': { tenantId: string; checklistId: string };
  'roster.changed': { tenantId: string; siteId: string; from: string; to: string };
  'occurrence.status_changed': { tenantId: string; occurrenceId: string; from: OccurrenceStatus | null; to: OccurrenceStatus; at: Date };
  'task.assigned': TaskEvent;
  'task.accepted': TaskEvent;
  'task.submitted': TaskEvent;
  'task.rejected': TaskEvent;
  'task.completed': TaskEvent;
  'task.cancelled': TaskEvent;
  'task.overdue': TaskEvent;
}

export type TaskEventName = Extract<keyof DomainEventMap, `task.${string}`>;

type Handler<K extends keyof DomainEventMap> = (e: DomainEventMap[K]) => void | Promise<void>;

/**
 * In-process events between modules. `emit` awaits every handler in registration order inside the
 * caller's tenant transaction, so a failing handler rolls the whole change back.
 */
@Injectable()
export class DomainEvents {
  private readonly handlers = new Map<keyof DomainEventMap, Handler<never>[]>();

  on<K extends keyof DomainEventMap>(name: K, handler: Handler<K>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(name, list);
    return () => {
      const current = this.handlers.get(name) ?? [];
      this.handlers.set(name, current.filter((h) => h !== (handler as Handler<never>)));
    };
  }

  async emit<K extends keyof DomainEventMap>(name: K, e: DomainEventMap[K]): Promise<void> {
    for (const handler of [...(this.handlers.get(name) ?? [])]) await (handler as Handler<K>)(e);
  }
}

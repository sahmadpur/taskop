import { Injectable } from '@nestjs/common';
import type { OccurrenceStatus } from '@taskop/contracts';

export interface DomainEventMap {
  'user.access_changed': { tenantId: string; userId: string };
  'checklist.deactivated': { tenantId: string; checklistId: string };
  'roster.changed': { tenantId: string; siteId: string; from: string; to: string };
  'occurrence.status_changed': { tenantId: string; occurrenceId: string; from: OccurrenceStatus | null; to: OccurrenceStatus; at: Date };
}

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

import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@taskop/contracts';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService, type Executor } from '../db/db.service';
import { notificationEvents } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import type { PayloadOf } from './payloads';
import { type FanoutJob, NOTIFICATION_QUEUES } from './queues';

/** Spec §6.1 step 1: one row per business event, inside the business transaction. */
@Injectable()
export class NotificationEvents {
  private readonly logger = new Logger('NotificationEvents');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
  ) {}

  /**
   * For listeners and the scan: never throws (NFR-11.01). The insert runs in a savepoint; on any error the savepoint
   * is rolled back and the error logged, so the business change still commits. True only when a row was inserted
   * (false for a repeated dedupe key and for a swallowed error).
   */
  async record<T extends NotificationType>(type: T, payload: PayloadOf[T], actorUserId: string | null, dedupeKey?: string): Promise<boolean> {
    try {
      const { tenantId } = this.db.context();
      const id = await this.db.tx().transaction((sp) => this.insert(sp, tenantId, type, payload, actorUserId, dedupeKey ?? null));
      if (!id) return false;
      this.queueFanout(tenantId, id);
      return true;
    } catch (e) {
      this.logger.error(sanitiseForLog(e, null), `Recording a ${type} notification failed; the business change still commits`);
      return false;
    }
  }

  /** For manual messages, whose sender must learn of a failure: throws. Null when the dedupe key already exists. */
  async create<T extends NotificationType>(type: T, payload: PayloadOf[T], actorUserId: string | null, dedupeKey: string | null = null): Promise<string | null> {
    const { tenantId } = this.db.context();
    const id = await this.insert(this.db.tx(), tenantId, type, payload, actorUserId, dedupeKey);
    if (id) this.queueFanout(tenantId, id);
    return id;
  }

  private async insert(tx: Executor, tenantId: string, type: NotificationType, payload: object, actorUserId: string | null, dedupeKey: string | null): Promise<string | null> {
    const [row] = await tx
      .insert(notificationEvents)
      .values({ tenantId, type, payload, actorUserId, dedupeKey, createdAt: this.clock.now() })
      // The partial unique index on (tenant_id, dedupe_key) makes a repeat a no-op.
      .onConflictDoNothing()
      .returning({ id: notificationEvents.id });
    return row?.id ?? null;
  }

  /** After the business transaction commits (dropped on rollback). A lost send is re-sent by the sweep. */
  private queueFanout(tenantId: string, eventId: string): void {
    const job: FanoutJob = { tenantId, eventId };
    this.db.afterCommit(async () => {
      try {
        await this.jobs.send(NOTIFICATION_QUEUES.fanout, job);
      } catch (e) {
        this.logger.error(sanitiseForLog(e, null), `Queueing fan-out of notification event ${eventId} failed; the sweep will retry`);
      }
    });
  }
}

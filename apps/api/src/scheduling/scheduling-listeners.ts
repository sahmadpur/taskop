import { Injectable, type OnModuleInit } from '@nestjs/common';
import { localDateOf } from '@taskop/contracts';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { assignments, shiftRoster } from '../db/schema';
import { OccurrenceWriter } from './occurrence-writer';

/** Keeps occurrences in step with changes made elsewhere (spec §5.1, §5.3). Handlers run in the caller's transaction. */
@Injectable()
export class SchedulingListeners implements OnModuleInit {
  constructor(
    private readonly events: DomainEvents,
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: OccurrenceWriter,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.events.on('roster.changed', (e) => this.writer.refreshSnapshots({ siteId: e.siteId, from: e.from, to: e.to }));
    this.events.on('user.access_changed', (e) => this.onUserAccessChanged(e.userId));
    this.events.on('checklist.deactivated', (e) => this.onChecklistDeactivated(e.checklistId));
  }

  /** Deactivated, reactivated or moved between sites: drop roster rows they can no longer work, then refresh. */
  private async onUserAccessChanged(userId: string): Promise<void> {
    const today = localDateOf(this.clock.now(), await this.writer.tenantTimezone());
    await this.db
      .tx()
      .delete(shiftRoster)
      .where(
        and(
          eq(shiftRoster.userId, userId),
          gte(shiftRoster.date, today),
          sql`(not exists (select 1 from users u where u.id = ${userId} and u.status = 'active')
            or not exists (select 1 from user_sites us where us.user_id = ${userId} and us.site_id = ${shiftRoster.siteId}))`,
        ),
      );
    await this.writer.refreshSnapshots({ userId });
  }

  /** Spec §5.3: pause the checklist's active assignments; reactivating the checklist does not resume them. */
  private async onChecklistDeactivated(checklistId: string): Promise<void> {
    const paused = await this.db
      .tx()
      .update(assignments)
      .set({ status: 'paused', revision: sql`${assignments.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(assignments.checklistId, checklistId), eq(assignments.status, 'active')))
      .returning({ id: assignments.id });
    for (const { id } of paused) {
      await this.writer.cancelFuturePending(id, 'checklist_deactivated');
      await this.audit.record({
        action: 'assignment.auto_paused',
        entityType: 'assignment',
        entityId: id,
        before: { status: 'active' },
        after: { status: 'paused', reason: 'checklist_deactivated' },
      });
    }
  }
}

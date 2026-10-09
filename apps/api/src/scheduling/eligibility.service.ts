import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { occurrenceAssignees, occurrences, shiftRoster } from '../db/schema';

export type CanStartFailure = 'NOT_FOUND' | 'NOT_ASSIGNED' | 'NOT_STARTABLE' | 'NOT_YET_OPEN' | 'CLOSED' | 'NOT_ON_SHIFT';
export type CanStartResult = { ok: true; late: boolean } | { ok: false; reason: CanStartFailure };

/** FR-09.09/09.10 (spec §5.4). Sub-project 4 calls this when a worker starts an occurrence; runs in a tenant transaction. */
@Injectable()
export class EligibilityService {
  constructor(private readonly db: DbService) {}

  /** `allowMissed`: a late-synced offline start may revive a missed occurrence (SP4 spec §6.2); every other rule still applies. */
  async canStart(occurrenceId: string, userId: string, at: Date, opts: { allowMissed?: boolean } = {}): Promise<CanStartResult> {
    const tx = this.db.tx();
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, occurrenceId));
    if (!o) return { ok: false, reason: 'NOT_FOUND' };
    const [assigned] = await tx
      .select({ userId: occurrenceAssignees.userId })
      .from(occurrenceAssignees)
      .where(and(eq(occurrenceAssignees.occurrenceId, occurrenceId), eq(occurrenceAssignees.userId, userId)));
    if (!assigned) return { ok: false, reason: 'NOT_ASSIGNED' };
    const startable = o.status === 'pending' || o.status === 'overdue' || (opts.allowMissed === true && o.status === 'missed');
    if (!startable) return { ok: false, reason: 'NOT_STARTABLE' };
    if (at < o.startsAt) return { ok: false, reason: 'NOT_YET_OPEN' };
    if (at >= o.closesAt) return { ok: false, reason: 'CLOSED' };
    if (o.shiftId) {
      const [rostered] = await tx
        .select({ userId: shiftRoster.userId })
        .from(shiftRoster)
        .where(and(eq(shiftRoster.userId, userId), eq(shiftRoster.shiftId, o.shiftId), eq(shiftRoster.siteId, o.siteId), eq(shiftRoster.date, o.localDate)));
      if (!rostered) return { ok: false, reason: 'NOT_ON_SHIFT' };
    }
    return { ok: true, late: at >= o.dueAt };
  }
}

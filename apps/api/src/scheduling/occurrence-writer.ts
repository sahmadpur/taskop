import { Injectable } from '@nestjs/common';
import {
  addDays,
  type CancelReasonCode,
  expandSchedule,
  localDateOf,
  type OccurrenceStatus,
  recurrenceSchema,
  SCHEDULING_LIMITS,
  type ShiftHours,
  timingSchema,
  zonedTimeToUtc,
} from '@taskop/contracts';
import { and, between, eq, gt, inArray, type SQL, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { assignments, occurrenceAssignees, occurrences, occurrenceStatusHistory, shifts, tenants } from '../db/schema';
import { hhmm } from './mappers';

export type SnapshotScope = { assignmentId: string } | { siteId: string; from: string; to: string } | { userId: string };

export interface Transition {
  occurrenceId: string;
  from: OccurrenceStatus | null;
  to: OccurrenceStatus;
  at: Date;
  reason?: string | null;
}

/** The only code that creates occurrences or changes their status (spec §5). Runs inside a tenant transaction. */
@Injectable()
export class OccurrenceWriter {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly events: DomainEvents,
  ) {}

  async tenantTimezone(): Promise<string> {
    const [t] = await this.db.tx().select({ timezone: tenants.timezone }).from(tenants);
    return t!.timezone;
  }

  async shiftHours(shiftId: string): Promise<ShiftHours | null> {
    const [s] = await this.db.tx().select({ startTime: shifts.startTime, endTime: shifts.endTime }).from(shifts).where(eq(shifts.id, shiftId));
    return s ? { startTime: hhmm(s.startTime), endTime: hhmm(s.endTime) } : null;
  }

  /**
   * Creates the occurrences an active assignment still lacks, up to today + 14 days (spec §5.1).
   * Slots start at or after `materialized_until` and close after now; on the first run (null) a window that is
   * already open is included. Afterwards `materialized_until` is the start of day today + 15, so every slot
   * is considered once and a cancelled occurrence is never recreated.
   */
  async materialize(assignmentId: string): Promise<number> {
    const tx = this.db.tx();
    const now = this.clock.now();
    const [a] = await tx.select().from(assignments).where(eq(assignments.id, assignmentId)).for('update');
    if (!a || a.status !== 'active') return 0;
    const tz = await this.tenantTimezone();
    const timing = timingSchema.parse(a.timing);
    const shift = timing.mode === 'shift' ? await this.shiftHours(timing.shiftId) : null;
    const today = localDateOf(now, tz);
    const until = a.materializedUntil;
    // First run: look back far enough for a window of up to 7 days that is still open.
    const from = until ? localDateOf(until, tz) : addDays(today, -8);
    const slots = expandSchedule(recurrenceSchema.parse(a.schedule), timing, shift, tz, from, addDays(today, SCHEDULING_LIMITS.horizonDays)).filter(
      (s) => (!until || s.startsAt >= until) && s.closesAt > now,
    );
    let created: { id: string }[] = [];
    if (slots.length) {
      created = await tx
        .insert(occurrences)
        .values(
          slots.map((s) => ({
            tenantId: a.tenantId,
            assignmentId: a.id,
            checklistId: a.checklistId,
            siteId: a.siteId,
            shiftId: a.shiftId,
            localDate: s.localDate,
            startsAt: s.startsAt,
            dueAt: s.dueAt,
            closesAt: s.closesAt,
            statusChangedAt: now,
          })),
        )
        // Targets the partial unique index occurrences_live_day_uq.
        .onConflictDoNothing({ target: [occurrences.assignmentId, occurrences.localDate], where: sql`status <> 'cancelled'` })
        .returning({ id: occurrences.id });
    }
    await tx
      .update(assignments)
      .set({ materializedUntil: zonedTimeToUtc(addDays(today, SCHEDULING_LIMITS.horizonDays + 1), 0, tz) })
      .where(eq(assignments.id, a.id));
    if (created.length) {
      const ids = created.map((c) => c.id);
      await this.insertSnapshots(ids);
      await this.recordTransitions(ids.map((occurrenceId) => ({ occurrenceId, from: null, to: 'pending', at: now })));
    }
    return created.length;
  }

  /** Recomputes who may do pending occurrences that have not started yet (spec §5.1 snapshot refresh). */
  async refreshSnapshots(scope: SnapshotScope): Promise<void> {
    const tx = this.db.tx();
    const conds: (SQL | undefined)[] = [eq(occurrences.status, 'pending'), gt(occurrences.startsAt, this.clock.now())];
    if ('assignmentId' in scope) conds.push(eq(occurrences.assignmentId, scope.assignmentId));
    else if ('siteId' in scope) conds.push(eq(occurrences.siteId, scope.siteId), between(occurrences.localDate, scope.from, scope.to));
    else {
      conds.push(sql`(exists (select 1 from assignment_assignees aa where aa.assignment_id = ${occurrences.assignmentId} and aa.user_id = ${scope.userId})
        or exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${scope.userId}))`);
    }
    const ids = (await tx.select({ id: occurrences.id }).from(occurrences).where(and(...conds))).map((r) => r.id);
    if (!ids.length) return;
    await tx.delete(occurrenceAssignees).where(inArray(occurrenceAssignees.occurrenceId, ids));
    await this.insertSnapshots(ids);
  }

  /** Cancels pending occurrences that start after now; open and overdue ones are kept. */
  async cancelFuturePending(assignmentId: string, reason: CancelReasonCode): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .tx()
      .update(occurrences)
      .set({ status: 'cancelled', cancelReason: reason, statusChangedAt: now, updatedAt: now })
      .where(and(eq(occurrences.assignmentId, assignmentId), eq(occurrences.status, 'pending'), gt(occurrences.startsAt, now)))
      .returning({ id: occurrences.id });
    await this.recordTransitions(rows.map((r) => ({ occurrenceId: r.id, from: 'pending', to: 'cancelled', at: now, reason })));
    return rows.length;
  }

  /** Generates from now on only (after a resume or an edit). */
  async restart(assignmentId: string): Promise<void> {
    await this.db.tx().update(assignments).set({ materializedUntil: this.clock.now() }).where(eq(assignments.id, assignmentId));
    await this.materialize(assignmentId);
  }

  /** After a schedule, timing or shift-hours change: future slots are rebuilt; open ones stay (spec §5.3). */
  async regenerate(assignmentId: string, reason: CancelReasonCode): Promise<void> {
    await this.cancelFuturePending(assignmentId, reason);
    await this.restart(assignmentId);
  }

  async recordTransitions(rows: Transition[]): Promise<void> {
    if (!rows.length) return;
    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    await this.db
      .tx()
      .insert(occurrenceStatusHistory)
      .values(
        rows.map((r) => ({
          tenantId,
          occurrenceId: r.occurrenceId,
          fromStatus: r.from,
          toStatus: r.to,
          at: r.at,
          actorUserId: actor.userId,
          actorPlatformAdminId: actor.platformAdminId,
          reason: r.reason ?? null,
        })),
      );
    for (const r of rows) {
      await this.events.emit('occurrence.status_changed', { tenantId, occurrenceId: r.occurrenceId, from: r.from, to: r.to, at: r.at });
    }
  }

  /** Eligible users: active assignees linked to the site, and for shift timing also rostered that day (FR-09.09). */
  private async insertSnapshots(occurrenceIds: string[]): Promise<void> {
    await this.db.tx().execute(sql`
      insert into occurrence_assignees (tenant_id, occurrence_id, user_id)
      select occurrences.tenant_id, occurrences.id, aa.user_id
      from occurrences
      join assignment_assignees aa on aa.assignment_id = occurrences.assignment_id
      join users u on u.id = aa.user_id and u.status = 'active'
      join user_sites us on us.user_id = aa.user_id and us.site_id = occurrences.site_id
      where ${inArray(occurrences.id, occurrenceIds)}
        and (occurrences.shift_id is null or exists (
          select 1 from shift_roster r
          where r.user_id = aa.user_id and r.shift_id = occurrences.shift_id
            and r.site_id = occurrences.site_id and r.date = occurrences.local_date))
      on conflict do nothing`);
  }
}

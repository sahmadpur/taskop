import { Injectable } from '@nestjs/common';
import {
  addDays,
  expandSchedule,
  localDateOf,
  type Recurrence,
  SCHEDULING_LIMITS,
  type ShiftHours,
  type Slot,
  type Timing,
  validateSchedule,
  windowMinutes,
} from '@taskop/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { checklists, shifts, sites, users } from '../db/schema';
import type { Actor } from './actor';
import { hhmm } from './mappers';
import { SchedulingScope } from './scheduling-scope';

/** Checks shared by create, update, resume and preview (spec §4.2). */
@Injectable()
export class AssignmentRules {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
    private readonly clock: Clock,
  ) {}

  async checklist(checklistId: string): Promise<void> {
    const [c] = await this.db
      .tx()
      .select({ status: checklists.status, currentVersionId: checklists.currentVersionId })
      .from(checklists)
      .where(eq(checklists.id, checklistId));
    if (!c) throw new AppError('REFERENCE_NOT_FOUND');
    if (c.status !== 'active') throw new AppError('CHECKLIST_DEACTIVATED');
    if (!c.currentVersionId) throw new AppError('CHECKLIST_NOT_PUBLISHED');
  }

  async site(a: Actor, siteId: string): Promise<void> {
    const [s] = await this.db.tx().select({ active: sites.active }).from(sites).where(eq(sites.id, siteId));
    if (!s) throw new AppError('REFERENCE_NOT_FOUND');
    await this.scope.assertSiteWritable(a, siteId);
    if (!s.active) throw new AppError('SITE_INACTIVE');
  }

  async assignees(siteId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const rows = await this.db
      .tx()
      .select({
        id: users.id,
        status: users.status,
        atSite: sql<boolean>`exists (select 1 from user_sites us where us.user_id = "users"."id" and us.site_id = ${siteId})`,
      })
      .from(users)
      .where(inArray(users.id, unique));
    if (rows.length !== unique.length) throw new AppError('REFERENCE_NOT_FOUND');
    const inactive = rows.filter((r) => r.status !== 'active').map((r) => r.id);
    if (inactive.length) throw new AppError('ASSIGNEE_INACTIVE', { details: { userIds: inactive } });
    const away = rows.filter((r) => !r.atSite).map((r) => r.id);
    if (away.length) throw new AppError('ASSIGNEE_NOT_AT_SITE', { details: { userIds: away } });
  }

  async shift(timing: Timing, siteId: string): Promise<(ShiftHours & { name: string }) | null> {
    if (timing.mode !== 'shift') return null;
    const [s] = await this.db.tx().select().from(shifts).where(eq(shifts.id, timing.shiftId));
    if (!s) throw new AppError('REFERENCE_NOT_FOUND');
    if (!s.active) throw new AppError('SHIFT_INACTIVE');
    if (s.siteId && s.siteId !== siteId) throw new AppError('SHIFT_NOT_AT_SITE');
    return { name: s.name, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime) };
  }

  schedule(r: Recurrence): void {
    const issues = validateSchedule(r);
    if (issues.length) throw new AppError('SCHEDULE_INVALID', { details: { issues: issues.map((i) => ({ ...i, path: ['schedule', ...i.path] })) } });
  }

  /** FR-09.05/06: ≤ 24h, or ≤ 7 days with assignments.extended_window (platform admins hold every permission). */
  window(a: Actor, timing: Timing, shift: ShiftHours | null): void {
    const minutes = windowMinutes(timing, shift);
    if (minutes > SCHEDULING_LIMITS.maxExtendedWindowMinutes) throw new AppError('WINDOW_INVALID');
    const extended = !a || a.permissions.has('assignments.extended_window');
    if (minutes > SCHEDULING_LIMITS.maxWindowMinutes && !extended) throw new AppError('WINDOW_TOO_LONG');
  }

  /** Slots that have not closed yet, from today on, in order. */
  nextSlots(r: Recurrence, timing: Timing, shift: ShiftHours | null, tz: string, limit: number): Slot[] {
    const now = this.clock.now();
    const today = localDateOf(now, tz);
    return expandSchedule(r, timing, shift, tz, addDays(today, -8), addDays(today, SCHEDULING_LIMITS.emptyCheckDays))
      .filter((s) => s.closesAt > now)
      .slice(0, limit);
  }

  nonEmpty(r: Recurrence, timing: Timing, shift: ShiftHours | null, tz: string): void {
    if (!this.nextSlots(r, timing, shift, tz, 1).length) throw new AppError('SCHEDULE_EMPTY');
  }
}

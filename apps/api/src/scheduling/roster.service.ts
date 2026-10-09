import { Injectable } from '@nestjs/common';
import { addDays, dayNumber, type RosterCopyResult, type RosterDto, type RosterRow } from '@taskop/contracts';
import { and, asc, between, eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DomainEvents } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { shiftRoster, shifts, sites, userSites, users } from '../db/schema';
import type { Actor } from './actor';
import type { CopyRosterDto, PutRosterDto, RosterQueryDto } from './dto';
import { SchedulingScope } from './scheduling-scope';
import { ShiftsService } from './shifts.service';

const rowKey = (r: RosterRow) => `${r.userId}|${r.shiftId}|${r.date}`;

@Injectable()
export class RosterService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: SchedulingScope,
    private readonly shifts: ShiftsService,
    private readonly events: DomainEvents,
  ) {}

  async get(a: Actor, q: RosterQueryDto): Promise<RosterDto> {
    await this.scope.assertSiteReadable(a, q.siteId);
    const tx = this.db.tx();
    const people = await tx
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .innerJoin(userSites, and(eq(userSites.userId, users.id), eq(userSites.siteId, q.siteId)))
      .where(and(eq(users.status, 'active'), this.scope.rosterUsers(a)))
      .orderBy(asc(users.fullName), asc(users.id));
    const rows = await tx
      .select({ userId: shiftRoster.userId, shiftId: shiftRoster.shiftId, date: shiftRoster.date })
      .from(shiftRoster)
      .where(and(eq(shiftRoster.siteId, q.siteId), between(shiftRoster.date, q.from, q.to), this.scope.roster(a)))
      .orderBy(asc(shiftRoster.date), asc(shiftRoster.userId), asc(shiftRoster.shiftId));
    return { siteId: q.siteId, from: q.from, to: q.to, users: people, shifts: await this.shifts.list({ siteId: q.siteId }), rows };
  }

  async put(a: Actor, input: PutRosterDto): Promise<RosterDto> {
    await this.assertSite(a, input.siteId);
    const rows = [...new Map(input.rows.map((r) => [rowKey(r), r])).values()];
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    // Rows already stored are kept as they are, even if their person left the site or their shift was deactivated
    // since; only new rows are checked, so a week stays saveable after such a change.
    const stored = await tx
      .select({ userId: shiftRoster.userId, shiftId: shiftRoster.shiftId, date: shiftRoster.date })
      .from(shiftRoster)
      .where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, input.from, input.to)));
    const storedKeys = new Set(stored.map(rowKey));
    await this.validateRows(input.siteId, rows.filter((r) => !storedKeys.has(rowKey(r))));
    const removed = await tx
      .delete(shiftRoster)
      .where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, input.from, input.to)))
      .returning({ userId: shiftRoster.userId });
    if (rows.length) await tx.insert(shiftRoster).values(rows.map((r) => ({ tenantId, siteId: input.siteId, ...r })));
    await this.audit.record({
      action: 'roster.replaced',
      entityType: 'site',
      entityId: input.siteId,
      before: { from: input.from, to: input.to, rowCount: removed.length },
      after: { from: input.from, to: input.to, rowCount: rows.length },
    });
    await this.events.emit('roster.changed', { tenantId, siteId: input.siteId, from: input.from, to: input.to });
    return this.get(a, { siteId: input.siteId, from: input.from, to: input.to });
  }

  /** Replaces each target week with the source week. Rows of users or shifts no longer valid are skipped. */
  async copy(a: Actor, input: CopyRosterDto): Promise<RosterCopyResult> {
    await this.assertSite(a, input.siteId);
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    const source = await tx
      .select({ userId: shiftRoster.userId, shiftId: shiftRoster.shiftId, date: shiftRoster.date })
      .from(shiftRoster)
      .innerJoin(users, and(eq(users.id, shiftRoster.userId), eq(users.status, 'active')))
      .innerJoin(userSites, and(eq(userSites.userId, shiftRoster.userId), eq(userSites.siteId, input.siteId)))
      .innerJoin(shifts, and(eq(shifts.id, shiftRoster.shiftId), eq(shifts.active, true)))
      .where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, input.sourceWeekStart, addDays(input.sourceWeekStart, 6))));
    const targets = [...new Set(input.targetWeekStarts)].sort();
    let rowCount = 0;
    for (const target of targets) {
      const to = addDays(target, 6);
      const offset = dayNumber(target) - dayNumber(input.sourceWeekStart);
      await tx.delete(shiftRoster).where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, target, to)));
      if (source.length) {
        await tx.insert(shiftRoster).values(source.map((r) => ({ tenantId, siteId: input.siteId, userId: r.userId, shiftId: r.shiftId, date: addDays(r.date, offset) })));
      }
      rowCount += source.length;
      await this.events.emit('roster.changed', { tenantId, siteId: input.siteId, from: target, to });
    }
    await this.audit.record({
      action: 'roster.copied',
      entityType: 'site',
      entityId: input.siteId,
      after: { sourceWeekStart: input.sourceWeekStart, targetWeekStarts: targets, rowCount },
    });
    return { rowCount };
  }

  private async assertSite(a: Actor, siteId: string): Promise<void> {
    const [site] = await this.db.tx().select({ active: sites.active }).from(sites).where(eq(sites.id, siteId));
    if (!site) throw new AppError('REFERENCE_NOT_FOUND');
    await this.scope.assertSiteWritable(a, siteId);
    if (!site.active) throw new AppError('SITE_INACTIVE');
  }

  private async validateRows(siteId: string, rows: RosterRow[]): Promise<void> {
    const tx = this.db.tx();
    const userIds = [...new Set(rows.map((r) => r.userId))];
    if (userIds.length) {
      const ok = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(userSites, and(eq(userSites.userId, users.id), eq(userSites.siteId, siteId)))
        .where(and(inArray(users.id, userIds), eq(users.status, 'active')));
      const okIds = new Set(ok.map((r) => r.id));
      const bad = userIds.filter((id) => !okIds.has(id));
      if (bad.length) throw new AppError('ROSTER_USER_NOT_AT_SITE', { details: { userIds: bad } });
    }
    const shiftIds = [...new Set(rows.map((r) => r.shiftId))];
    if (shiftIds.length) {
      const found = await tx.select({ active: shifts.active, siteId: shifts.siteId }).from(shifts).where(inArray(shifts.id, shiftIds));
      if (found.length !== shiftIds.length) throw new AppError('REFERENCE_NOT_FOUND');
      if (found.some((s) => !s.active)) throw new AppError('SHIFT_INACTIVE');
      if (found.some((s) => s.siteId !== null && s.siteId !== siteId)) throw new AppError('SHIFT_NOT_AT_SITE');
    }
  }
}

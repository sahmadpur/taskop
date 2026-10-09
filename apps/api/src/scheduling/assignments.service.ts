import { Injectable } from '@nestjs/common';
import {
  addDays,
  type AssignmentDetail,
  type AssignmentDto,
  type AssignmentPreview,
  localDateOf,
  type Page,
  type PreviewWarning,
  SCHEDULING_LIMITS,
  scheduleWarnings,
  timingSchema,
} from '@taskop/contracts';
import { and, between, desc, eq, getTableColumns, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { assignmentAssignees, assignments, checklists, shiftRoster, shifts, sites } from '../db/schema';
import type { Actor } from './actor';
import { AssignmentRules } from './assignment-rules';
import type { AssignmentListQueryDto, CreateAssignmentDto, PreviewAssignmentDto, UpdateAssignmentDto } from './dto';
import { sameJson, toAssignmentDto } from './mappers';
import { OccurrenceQueries } from './occurrence-queries';
import { OccurrenceWriter } from './occurrence-writer';
import { SchedulingScope } from './scheduling-scope';

/** What the audit log keeps for an assignment. */
export const auditView = (d: AssignmentDto) => ({
  name: d.name,
  checklistId: d.checklistId,
  siteId: d.siteId,
  schedule: d.schedule,
  timing: d.timing,
  assigneeIds: d.assignees.map((u) => u.id),
  status: d.status,
});

@Injectable()
export class AssignmentsService {
  constructor(
    protected readonly db: DbService,
    protected readonly audit: AuditService,
    protected readonly clock: Clock,
    protected readonly scope: SchedulingScope,
    protected readonly rules: AssignmentRules,
    protected readonly writer: OccurrenceWriter,
    protected readonly queries: OccurrenceQueries,
  ) {}

  async list(a: Actor, q: AssignmentListQueryDto): Promise<Page<AssignmentDto>> {
    const conds: (SQL | undefined)[] = [this.scope.assignments(a)];
    if (q.siteId) conds.push(eq(assignments.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(assignments.checklistId, q.checklistId));
    if (q.status) conds.push(eq(assignments.status, q.status));
    if (q.assigneeId) conds.push(sql`exists (select 1 from assignment_assignees aa where aa.assignment_id = ${assignments.id} and aa.user_id = ${q.assigneeId})`);
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(assignments.name, pattern), ilike(checklists.name, pattern)));
    }
    if (q.cursor) conds.push(lt(assignments.id, q.cursor));
    const rows = await this.select().where(and(...conds)).orderBy(desc(assignments.id)).limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toAssignmentDto);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(a: Actor, id: string): Promise<AssignmentDetail> {
    const [row] = await this.select().where(and(eq(assignments.id, id), this.scope.assignments(a)));
    if (!row) throw new AppError('NOT_FOUND');
    return { ...toAssignmentDto(row), upcoming: await this.queries.upcoming(id) };
  }

  async create(a: Actor, input: CreateAssignmentDto): Promise<AssignmentDetail> {
    await this.rules.site(a, input.siteId);
    await this.rules.checklist(input.checklistId);
    this.rules.schedule(input.schedule);
    const shift = await this.rules.shift(input.timing, input.siteId);
    this.rules.window(a, input.timing, shift);
    const assigneeIds = [...new Set(input.assigneeIds)];
    await this.rules.assignees(input.siteId, assigneeIds);
    this.rules.nonEmpty(input.schedule, input.timing, shift, await this.writer.tenantTimezone());

    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    const tx = this.db.tx();
    const [row] = await tx
      .insert(assignments)
      .values({
        tenantId,
        checklistId: input.checklistId,
        siteId: input.siteId,
        name: input.name || null,
        schedule: input.schedule,
        timing: input.timing,
        shiftId: input.timing.mode === 'shift' ? input.timing.shiftId : null,
        createdByUserId: actor.userId,
        createdByPlatformAdminId: actor.platformAdminId,
      })
      .returning({ id: assignments.id });
    const id = row!.id;
    await tx.insert(assignmentAssignees).values(assigneeIds.map((userId) => ({ tenantId, assignmentId: id, userId })));
    await this.writer.materialize(id);
    const dto = await this.get(a, id);
    await this.audit.record({ action: 'assignment.created', entityType: 'assignment', entityId: id, after: auditView(dto) });
    return dto;
  }

  async update(a: Actor, id: string, input: UpdateAssignmentDto): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status === 'ended') throw new AppError('ASSIGNMENT_ENDED');
    if (row.revision !== input.revision) throw new AppError('REVISION_CONFLICT', { details: { currentRevision: row.revision } });
    const before = await this.get(a, id);
    const schedule = input.schedule ?? before.schedule;
    const timing = input.timing ?? before.timing;
    const scheduleChanged = !sameJson(schedule, before.schedule);
    const timingChanged = !sameJson(timing, before.timing);
    const currentIds = before.assignees.map((u) => u.id).sort();
    const assigneeIds = input.assigneeIds ? [...new Set(input.assigneeIds)].sort() : currentIds;
    const assigneesChanged = !sameJson(assigneeIds, currentIds);
    if (scheduleChanged || timingChanged) {
      this.rules.schedule(schedule);
      const shift = await this.rules.shift(timing, row.siteId);
      if (timingChanged) this.rules.window(a, timing, shift);
      this.rules.nonEmpty(schedule, timing, shift, await this.writer.tenantTimezone());
    }
    if (assigneesChanged) await this.rules.assignees(row.siteId, assigneeIds);

    const tx = this.db.tx();
    await tx
      .update(assignments)
      .set({
        name: input.name === undefined ? undefined : input.name || null,
        schedule,
        timing,
        shiftId: timing.mode === 'shift' ? timing.shiftId : null,
        revision: row.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(assignments.id, id));
    if (assigneesChanged) {
      await tx.delete(assignmentAssignees).where(eq(assignmentAssignees.assignmentId, id));
      await tx.insert(assignmentAssignees).values(assigneeIds.map((userId) => ({ tenantId: row.tenantId, assignmentId: id, userId })));
    }
    if (row.status === 'active') {
      if (scheduleChanged || timingChanged) await this.writer.regenerate(id, 'assignment_edited');
      else if (assigneesChanged) await this.writer.refreshSnapshots({ assignmentId: id });
    }
    const after = await this.get(a, id);
    await this.audit.record({ action: 'assignment.updated', entityType: 'assignment', entityId: id, before: auditView(before), after: auditView(after) });
    return after;
  }

  async pause(a: Actor, id: string): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status === 'ended') throw new AppError('ASSIGNMENT_ENDED');
    if (row.status === 'active') {
      await this.writer.cancelFuturePending(id, 'assignment_paused');
      await this.setStatus(row, 'paused', 'assignment.paused');
    }
    return this.get(a, id);
  }

  /** Re-checks spec §4.2, then generates from now on. */
  async resume(a: Actor, id: string): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status === 'ended') throw new AppError('ASSIGNMENT_ENDED');
    if (row.status === 'paused') {
      await this.rules.checklist(row.checklistId);
      await this.rules.site(a, row.siteId);
      await this.rules.shift(timingSchema.parse(row.timing), row.siteId);
      const ids = await this.db.tx().select({ userId: assignmentAssignees.userId }).from(assignmentAssignees).where(eq(assignmentAssignees.assignmentId, id));
      await this.rules.assignees(row.siteId, ids.map((r) => r.userId));
      await this.setStatus(row, 'active', 'assignment.resumed');
      await this.writer.restart(id);
    }
    return this.get(a, id);
  }

  async end(a: Actor, id: string): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status !== 'ended') {
      await this.writer.cancelFuturePending(id, 'assignment_ended');
      await this.setStatus(row, 'ended', 'assignment.ended');
    }
    return this.get(a, id);
  }

  private async lockWritable(a: Actor, id: string): Promise<typeof assignments.$inferSelect> {
    const [row] = await this.db.tx().select().from(assignments).where(and(eq(assignments.id, id), this.scope.assignments(a))).for('update');
    if (!row) throw new AppError('NOT_FOUND');
    await this.scope.assertSiteWritable(a, row.siteId);
    return row;
  }

  private async setStatus(row: typeof assignments.$inferSelect, status: 'active' | 'paused' | 'ended', action: string): Promise<void> {
    await this.db.tx().update(assignments).set({ status, revision: row.revision + 1, updatedAt: new Date() }).where(eq(assignments.id, row.id));
    await this.audit.record({ action, entityType: 'assignment', entityId: row.id, before: { status: row.status }, after: { status } });
  }

  async preview(a: Actor, input: PreviewAssignmentDto): Promise<AssignmentPreview> {
    await this.rules.site(a, input.siteId);
    this.rules.schedule(input.schedule);
    const shift = await this.rules.shift(input.timing, input.siteId);
    this.rules.window(a, input.timing, shift);
    const tz = await this.writer.tenantTimezone();
    const slots = this.rules.nextSlots(input.schedule, input.timing, shift, tz, SCHEDULING_LIMITS.previewSlots);
    const warnings: PreviewWarning[] = scheduleWarnings(input.schedule);
    if (input.timing.mode === 'shift' && input.assigneeIds?.length) {
      const today = localDateOf(this.clock.now(), tz);
      const [hit] = await this.db
        .tx()
        .select({ userId: shiftRoster.userId })
        .from(shiftRoster)
        .where(
          and(
            eq(shiftRoster.siteId, input.siteId),
            eq(shiftRoster.shiftId, input.timing.shiftId),
            inArray(shiftRoster.userId, input.assigneeIds),
            between(shiftRoster.date, today, addDays(today, SCHEDULING_LIMITS.horizonDays)),
          ),
        )
        .limit(1);
      if (!hit) warnings.push('NO_ROSTERED_ASSIGNEES');
    }
    return {
      slots: slots.map((s) => ({ localDate: s.localDate, startsAt: s.startsAt.toISOString(), dueAt: s.dueAt.toISOString(), closesAt: s.closesAt.toISOString() })),
      warnings,
    };
  }

  protected select() {
    return this.db
      .tx()
      .select({
        a: getTableColumns(assignments),
        checklistName: checklists.name,
        siteName: sites.name,
        shiftName: shifts.name,
        assignees: sql<{ id: string; fullName: string }[]>`coalesce((
          select json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by u.full_name, u.id)
          from assignment_assignees aa join users u on u.id = aa.user_id
          where aa.assignment_id = "assignments"."id"), '[]'::json)`,
      })
      .from(assignments)
      .innerJoin(checklists, eq(checklists.id, assignments.checklistId))
      .innerJoin(sites, eq(sites.id, assignments.siteId))
      .leftJoin(shifts, eq(shifts.id, assignments.shiftId))
      .$dynamic();
  }
}

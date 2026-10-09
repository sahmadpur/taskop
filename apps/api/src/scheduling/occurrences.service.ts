import { Injectable } from '@nestjs/common';
import type { OccurrenceDetail, OccurrenceDto, OccurrenceStatus, Page } from '@taskop/contracts';
import { and, asc, between, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { occurrenceAssignees, occurrences, occurrenceStatusHistory, users } from '../db/schema';
import type { Actor } from './actor';
import type { CancelOccurrenceDto, MyOccurrenceQueryDto, OccurrenceListQueryDto } from './dto';
import { toHistoryEntry, toOccurrenceDto } from './mappers';
import { OccurrenceQueries } from './occurrence-queries';
import { OccurrenceWriter } from './occurrence-writer';
import { SchedulingScope } from './scheduling-scope';

interface PageQuery {
  from: string;
  to: string;
  status?: OccurrenceStatus[];
  cursor?: string;
  limit: number;
}

@Injectable()
export class OccurrencesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly queries: OccurrenceQueries,
    private readonly writer: OccurrenceWriter,
  ) {}

  list(a: Actor, q: OccurrenceListQueryDto): Promise<Page<OccurrenceDto>> {
    const conds: (SQL | undefined)[] = [this.scope.occurrences(a)];
    if (q.siteId) conds.push(eq(occurrences.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(occurrences.checklistId, q.checklistId));
    if (q.assignmentId) conds.push(eq(occurrences.assignmentId, q.assignmentId));
    if (q.assigneeId) conds.push(this.hasAssignee(q.assigneeId));
    return this.page(q, conds);
  }

  /** FR-10.01 groundwork: the caller's own snapshot, no permission needed. */
  listMine(p: Principal, q: MyOccurrenceQueryDto): Promise<Page<OccurrenceDto>> {
    return this.page(q, [this.hasAssignee(p.userId)]);
  }

  async get(a: Actor, id: string): Promise<OccurrenceDetail> {
    const [row] = await this.queries.select().where(and(eq(occurrences.id, id), this.scope.occurrences(a)));
    if (!row) throw new AppError('NOT_FOUND');
    const tx = this.db.tx();
    const assignees = await tx
      .select({ id: users.id, fullName: users.fullName })
      .from(occurrenceAssignees)
      .innerJoin(users, eq(users.id, occurrenceAssignees.userId))
      .where(eq(occurrenceAssignees.occurrenceId, id))
      .orderBy(asc(users.fullName), asc(users.id));
    const history = await tx
      .select({ h: getTableColumns(occurrenceStatusHistory), actorName: users.fullName })
      .from(occurrenceStatusHistory)
      .leftJoin(users, eq(users.id, occurrenceStatusHistory.actorUserId))
      .where(eq(occurrenceStatusHistory.occurrenceId, id))
      .orderBy(asc(occurrenceStatusHistory.at), asc(occurrenceStatusHistory.id));
    return { ...toOccurrenceDto(row), assignees, history: history.map(toHistoryEntry) };
  }

  async cancel(a: Actor, id: string, input: CancelOccurrenceDto): Promise<OccurrenceDetail> {
    const tx = this.db.tx();
    const [row] = await tx.select().from(occurrences).where(and(eq(occurrences.id, id), this.scope.occurrences(a))).for('update');
    if (!row) throw new AppError('NOT_FOUND');
    await this.scope.assertSiteWritable(a, row.siteId);
    if (row.status !== 'pending' && row.status !== 'overdue') throw new AppError('OCCURRENCE_NOT_CANCELLABLE');
    const now = this.clock.now();
    await tx.update(occurrences).set({ status: 'cancelled', cancelReason: input.reason, statusChangedAt: now, updatedAt: now }).where(eq(occurrences.id, id));
    await this.writer.recordTransitions([{ occurrenceId: id, from: row.status, to: 'cancelled', at: now, reason: input.reason }]);
    await this.audit.record({
      action: 'occurrence.cancelled',
      entityType: 'occurrence',
      entityId: id,
      before: { status: row.status },
      after: { status: 'cancelled', reason: input.reason },
    });
    return this.get(a, id);
  }

  private hasAssignee(userId: string): SQL {
    return sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${userId})`;
  }

  /** Keyset pagination on (starts_at, id). */
  private async page(q: PageQuery, conds: (SQL | undefined)[]): Promise<Page<OccurrenceDto>> {
    const where = [...conds, between(occurrences.localDate, q.from, q.to)];
    if (q.status) where.push(inArray(occurrences.status, q.status));
    if (q.cursor) where.push(sql`(${occurrences.startsAt}, ${occurrences.id}) > (select c.starts_at, c.id from occurrences c where c.id = ${q.cursor})`);
    const rows = await this.queries
      .select()
      .where(and(...where))
      .orderBy(asc(occurrences.startsAt), asc(occurrences.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toOccurrenceDto);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }
}

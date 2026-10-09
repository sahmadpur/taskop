import { Injectable } from '@nestjs/common';
import type { OccurrenceDto } from '@taskop/contracts';
import { and, asc, eq, getTableColumns, gt, inArray, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { assignments, checklists, occurrences, shifts, sites } from '../db/schema';
import { toOccurrenceDto } from './mappers';

@Injectable()
export class OccurrenceQueries {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  select() {
    return this.db
      .tx()
      .select({
        o: getTableColumns(occurrences),
        assignmentName: assignments.name,
        checklistName: checklists.name,
        siteName: sites.name,
        shiftName: shifts.name,
        // Qualified explicitly: in a select list Drizzle renders a column as its bare name.
        assigneeIds: sql<string[]>`array(select oa.user_id::text from occurrence_assignees oa where oa.occurrence_id = "occurrences"."id" order by oa.user_id)`,
      })
      .from(occurrences)
      .innerJoin(assignments, eq(assignments.id, occurrences.assignmentId))
      .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
      .innerJoin(sites, eq(sites.id, occurrences.siteId))
      .leftJoin(shifts, eq(shifts.id, occurrences.shiftId))
      .$dynamic();
  }

  async upcoming(assignmentId: string, limit = 5): Promise<OccurrenceDto[]> {
    const rows = await this.select()
      .where(and(eq(occurrences.assignmentId, assignmentId), inArray(occurrences.status, ['pending', 'overdue']), gt(occurrences.closesAt, this.clock.now())))
      .orderBy(asc(occurrences.startsAt))
      .limit(limit);
    return rows.map(toOccurrenceDto);
  }
}

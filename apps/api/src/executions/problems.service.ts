import { Injectable } from '@nestjs/common';
import type { Page, ProblemDto } from '@taskop/contracts';
import { and, between, desc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { executionProblems, occurrences } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { ProblemListQueryDto } from './dto';
import { resolutionFilter, selectProblemRows, toProblemDtos } from './problem-rows';

/** GET /problems (spec §6.8): read-only, newest first, data scope through the occurrence; resolution from the task. */
@Injectable()
export class ProblemsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  async list(p: Principal, q: ProblemListQueryDto): Promise<Page<ProblemDto>> {
    const conds: (SQL | undefined)[] = [this.scope.occurrences(p), between(occurrences.localDate, q.from, q.to)];
    if (q.siteId) conds.push(eq(executionProblems.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(executionProblems.checklistId, q.checklistId));
    if (q.severity) conds.push(eq(executionProblems.severity, q.severity));
    if (q.source) conds.push(eq(executionProblems.source, q.source));
    if (q.resolution) conds.push(resolutionFilter(q.resolution));
    // Cleared by a correction (SP8 spec §8.3): hidden unless asked for.
    if (!q.includeCleared) conds.push(isNull(executionProblems.clearedAt));
    if (q.cursor) {
      conds.push(sql`(${executionProblems.createdAt}, ${executionProblems.id}) < (select c.created_at, c.id from execution_problems c where c.id = ${q.cursor})`);
    }
    const tx = this.db.tx();
    const rows = await selectProblemRows(tx)
      .where(and(...conds))
      .orderBy(desc(executionProblems.createdAt), desc(executionProblems.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return { items: await toProblemDtos(tx, page), nextCursor: rows.length > q.limit ? page[page.length - 1]!.pr.id : null };
  }
}

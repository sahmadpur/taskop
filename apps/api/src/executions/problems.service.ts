import { Injectable } from '@nestjs/common';
import { type Page, type ProblemDto, walkItems } from '@taskop/contracts';
import { and, between, desc, eq, getTableColumns, type SQL, sql } from 'drizzle-orm';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklists, executionProblems, executions, occurrences, sites, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { ProblemListQueryDto } from './dto';
import { ExecutionLookups } from './execution-lookups';

/** GET /problems (spec §6.8): read-only, newest first, data scope through the occurrence. */
@Injectable()
export class ProblemsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
    private readonly lookups: ExecutionLookups,
  ) {}

  async list(p: Principal, q: ProblemListQueryDto): Promise<Page<ProblemDto>> {
    const conds: (SQL | undefined)[] = [this.scope.occurrences(p), between(occurrences.localDate, q.from, q.to)];
    if (q.siteId) conds.push(eq(executionProblems.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(executionProblems.checklistId, q.checklistId));
    if (q.severity) conds.push(eq(executionProblems.severity, q.severity));
    if (q.source) conds.push(eq(executionProblems.source, q.source));
    if (q.cursor) {
      conds.push(sql`(${executionProblems.createdAt}, ${executionProblems.id}) < (select c.created_at, c.id from execution_problems c where c.id = ${q.cursor})`);
    }
    const rows = await this.db
      .tx()
      .select({
        pr: getTableColumns(executionProblems),
        localDate: occurrences.localDate,
        siteName: sites.name,
        checklistName: checklists.name,
        executorName: users.fullName,
        versionId: executions.checklistVersionId,
      })
      .from(executionProblems)
      .innerJoin(occurrences, eq(occurrences.id, executionProblems.occurrenceId))
      .innerJoin(executions, eq(executions.id, executionProblems.executionId))
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .innerJoin(sites, eq(sites.id, executionProblems.siteId))
      .innerJoin(checklists, eq(checklists.id, executionProblems.checklistId))
      .where(and(...conds))
      .orderBy(desc(executionProblems.createdAt), desc(executionProblems.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const labels = new Map<string, Map<string, string>>();
    for (const versionId of new Set(page.map((r) => r.versionId))) {
      const byItem = new Map<string, string>();
      walkItems(await this.lookups.content(versionId), (item) => byItem.set(item.id, item.label));
      labels.set(versionId, byItem);
    }
    return {
      items: page.map((r) => ({
        id: r.pr.id,
        executionId: r.pr.executionId,
        occurrenceId: r.pr.occurrenceId,
        localDate: r.localDate,
        siteId: r.pr.siteId,
        siteName: r.siteName,
        checklistId: r.pr.checklistId,
        checklistName: r.checklistName,
        itemId: r.pr.itemId,
        itemLabel: labels.get(r.versionId)?.get(r.pr.itemId) ?? null,
        source: r.pr.source,
        severity: r.pr.severity,
        note: r.pr.note,
        mediaIds: r.pr.mediaIds,
        executorName: r.executorName,
        createdAt: r.pr.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.pr.id : null,
    };
  }
}

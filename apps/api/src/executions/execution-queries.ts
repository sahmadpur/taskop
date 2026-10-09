import { Injectable } from '@nestjs/common';
import type { ExecutionDetail, ScoreResult } from '@taskop/contracts';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklistVersions, executionMedia, executionProblems, executions, occurrences, users } from '../db/schema';
import { toOccurrenceDto } from '../scheduling/mappers';
import { OccurrenceQueries } from '../scheduling/occurrence-queries';
import { ExecutionAccess } from './execution-access';
import { ExecutionLookups } from './execution-lookups';
import { asDevice, executionSummaryColumns, toExecutionSummary, toMediaDto, toProblemEntry } from './mappers';

/** GET /executions/:id (spec §6.8): everything the web drawer's "İcra" tab shows. */
@Injectable()
export class ExecutionQueries {
  constructor(
    private readonly db: DbService,
    private readonly access: ExecutionAccess,
    private readonly occurrenceQueries: OccurrenceQueries,
    private readonly lookups: ExecutionLookups,
  ) {}

  async detail(p: Principal, id: string): Promise<ExecutionDetail> {
    const tx = this.db.tx();
    const [row] = await tx.select(executionSummaryColumns).from(executions).innerJoin(users, eq(users.id, executions.executorUserId)).where(eq(executions.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    await this.access.assertCanRead(p, row.x.executorUserId, row.x.occurrenceId);
    const [occurrence] = await this.occurrenceQueries.select().where(eq(occurrences.id, row.x.occurrenceId));
    const [version] = await tx.select({ number: checklistVersions.number }).from(checklistVersions).where(eq(checklistVersions.id, row.x.checklistVersionId));
    const media = await tx
      .select({ m: getTableColumns(executionMedia), capturedByName: users.fullName })
      .from(executionMedia)
      .innerJoin(users, eq(users.id, executionMedia.capturedByUserId))
      .where(eq(executionMedia.executionId, id))
      .orderBy(asc(executionMedia.capturedAt), asc(executionMedia.id));
    const problems = await tx.select().from(executionProblems).where(eq(executionProblems.executionId, id)).orderBy(asc(executionProblems.createdAt), asc(executionProblems.id));
    return {
      ...toExecutionSummary(row),
      occurrence: toOccurrenceDto(occurrence!),
      checklistVersionId: row.x.checklistVersionId,
      versionNumber: version!.number!,
      content: await this.lookups.content(row.x.checklistVersionId),
      answers: row.x.answers as ExecutionDetail['answers'],
      answersRev: row.x.answersRev,
      score: (row.x.score as ScoreResult | null) ?? null,
      clockOffsetMs: row.x.clockOffsetMs,
      device: asDevice(row.x.device),
      lastSyncedAt: row.x.lastSyncedAt.toISOString(),
      media: media.map(toMediaDto),
      problems: problems.map(toProblemEntry),
    };
  }
}

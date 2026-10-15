import { Injectable } from '@nestjs/common';
import type { ExecutionCorrections, ExecutionDetail, ScoreResult } from '@taskop/contracts';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklistVersions, executionMedia, executionProblems, executions, occurrences, tasks, users } from '../db/schema';
import { toOccurrenceDto } from '../scheduling/mappers';
import { OccurrenceQueries } from '../scheduling/occurrence-queries';
import { AuditLookup } from './audit-lookup';
import { CorrectionHistory } from './correction-history';
import { ExecutionAccess } from './execution-access';
import { ExecutionLookups } from './execution-lookups';
import { asDevice, executionSummaryColumns, type ExecutionSummaryRow, toExecutionSummary, toMediaDto, toProblemEntry } from './mappers';
import { ReworkRequests } from './rework-requests';

/** GET /executions/:id (spec §6.8): everything the web drawer's "İcra" tab shows; and its correction history (SP8 spec §6.2). */
@Injectable()
export class ExecutionQueries {
  constructor(
    private readonly db: DbService,
    private readonly access: ExecutionAccess,
    private readonly occurrenceQueries: OccurrenceQueries,
    private readonly lookups: ExecutionLookups,
    private readonly requests: ReworkRequests,
    private readonly audits: AuditLookup,
    private readonly history: CorrectionHistory,
  ) {}

  async detail(p: Principal, id: string): Promise<ExecutionDetail> {
    const row = await this.summaryRow(id);
    await this.access.assertCanRead(p, row.x.executorUserId, row.x.occurrenceId);
    return this.build(row);
  }

  /** For callers that checked access themselves (the audits module, SP8 spec §6.1). */
  async load(id: string): Promise<ExecutionDetail> {
    return this.build(await this.summaryRow(id));
  }

  async corrections(p: Principal, id: string): Promise<ExecutionCorrections> {
    const row = await this.summaryRow(id);
    await this.access.assertCanRead(p, row.x.executorUserId, row.x.occurrenceId);
    return this.history.of(id);
  }

  private async summaryRow(id: string): Promise<ExecutionSummaryRow> {
    const [row] = await this.db.tx().select(executionSummaryColumns).from(executions).innerJoin(users, eq(users.id, executions.executorUserId)).where(eq(executions.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async build(row: ExecutionSummaryRow): Promise<ExecutionDetail> {
    const tx = this.db.tx();
    const id = row.x.id;
    const [occurrence] = await this.occurrenceQueries.select().where(eq(occurrences.id, row.x.occurrenceId));
    const [version] = await tx.select({ number: checklistVersions.number }).from(checklistVersions).where(eq(checklistVersions.id, row.x.checklistVersionId));
    const media = await tx
      .select({ m: getTableColumns(executionMedia), capturedByName: users.fullName })
      .from(executionMedia)
      .innerJoin(users, eq(users.id, executionMedia.capturedByUserId))
      .where(eq(executionMedia.executionId, id))
      .orderBy(asc(executionMedia.capturedAt), asc(executionMedia.id));
    const problems = await tx
      .select({ p: getTableColumns(executionProblems), taskId: tasks.id, taskStatus: tasks.status })
      .from(executionProblems)
      .leftJoin(tasks, eq(tasks.problemId, executionProblems.id))
      .where(eq(executionProblems.executionId, id))
      .orderBy(asc(executionProblems.createdAt), asc(executionProblems.id));
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
      // Every problem, cleared ones included, each with clearedAt (Spec decision 18).
      problems: problems.map((r) => toProblemEntry(r.p, r.taskId, r.taskStatus)),
      reworkRound: row.x.reworkRound,
      rework: (await this.requests.openByExecution([id])).get(id) ?? null,
      corrected: row.x.originalCapturedAt !== null,
      audit: await this.audits.brief(id, occurrence!.o.status),
    };
  }
}

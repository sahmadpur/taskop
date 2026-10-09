import { Injectable } from '@nestjs/common';
import { EXECUTION_LIMITS, type ExecutionProgress, type MyExecution, type SyncResponse } from '@taskop/contracts';
import { and, asc, eq, getTableColumns, gt, gte, inArray, lt, ne, or } from 'drizzle-orm';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklistVersions, executions, occurrenceAssignees, occurrences } from '../db/schema';
import { OccurrenceQueries } from '../scheduling/occurrence-queries';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import type { SyncQueryDto } from './dto';
import { ExecutionLookups } from './execution-lookups';
import { mediaPendingSql } from './mappers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** GET /me/sync (spec §6.1): what the phone needs to work offline for the next days. */
@Injectable()
export class SyncService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly queries: OccurrenceQueries,
    private readonly writer: OccurrenceWriter,
    private readonly lookups: ExecutionLookups,
  ) {}

  async pull(p: Principal, q: SyncQueryDto): Promise<SyncResponse> {
    const tx = this.db.tx();
    const now = this.clock.now();
    const from = new Date(+now - EXECUTION_LIMITS.syncPastDays * DAY);
    const to = new Date(+now + EXECUTION_LIMITS.syncFutureDays * DAY);
    // Driven by the indexes: the caller's assignee rows (tenant, user) joined to occurrences in the window, plus the
    // occurrences of the caller's active executions (tenant, executor) — an executor removed from the snapshot after
    // starting still finishes their own execution.
    const assignedRows = await tx
      .select({ id: occurrences.id })
      .from(occurrenceAssignees)
      .innerJoin(occurrences, eq(occurrences.id, occurrenceAssignees.occurrenceId))
      .where(
        and(
          eq(occurrenceAssignees.tenantId, p.tenantId),
          eq(occurrenceAssignees.userId, p.userId),
          ne(occurrences.status, 'cancelled'),
          lt(occurrences.startsAt, to),
          gt(occurrences.closesAt, from),
        ),
      );
    const executingRows = await tx
      .select({ id: executions.occurrenceId })
      .from(executions)
      .where(and(eq(executions.tenantId, p.tenantId), eq(executions.executorUserId, p.userId), eq(executions.state, 'active')));
    const assignedIds = assignedRows.map((r) => r.id);
    const ids = [...new Set([...assignedIds, ...executingRows.map((r) => r.id)])];
    // The first download by an assignee pins the version (spec §5.1); someone only finishing their own execution pins nothing.
    await this.writer.pinVersions(assignedIds);
    const rows = ids.length
      ? await this.queries.select().where(inArray(occurrences.id, ids)).orderBy(asc(occurrences.startsAt), asc(occurrences.id))
      : [];
    const claims = await this.lookups.claims(ids);
    const own = await tx
      .select({ x: getTableColumns(executions), mediaPending: mediaPendingSql })
      .from(executions)
      .where(
        and(
          eq(executions.executorUserId, p.userId),
          or(eq(executions.state, 'active'), gte(executions.updatedAt, new Date(+now - EXECUTION_LIMITS.syncFinishedHours * HOUR))),
        ),
      )
      .orderBy(asc(executions.startedAt), asc(executions.id));
    // Every version the phone needs: those of the listed occurrences and of its own executions.
    const known = new Set(q.knownVersionIds);
    const referenced = [...rows.map((r) => r.o.checklistVersionId), ...own.map((r) => r.x.checklistVersionId)];
    const versionIds = [...new Set(referenced.filter((v): v is string => v !== null && !known.has(v)))];
    const versions = versionIds.length
      ? await tx
          .select({ id: checklistVersions.id, checklistId: checklistVersions.checklistId, number: checklistVersions.number, content: checklistVersions.content })
          .from(checklistVersions)
          .where(inArray(checklistVersions.id, versionIds))
      : [];
    return {
      serverTime: now.toISOString(),
      occurrences: rows.map((r) => ({
        id: r.o.id,
        checklistId: r.o.checklistId,
        checklistName: r.checklistName,
        siteId: r.o.siteId,
        siteName: r.siteName,
        shiftName: r.shiftName,
        localDate: r.o.localDate,
        startsAt: r.o.startsAt.toISOString(),
        dueAt: r.o.dueAt.toISOString(),
        closesAt: r.o.closesAt.toISOString(),
        status: r.o.status,
        checklistVersionId: r.o.checklistVersionId!,
        claim: claims.get(r.o.id) ?? null,
      })),
      checklistVersions: versions.map((v) => ({
        id: v.id,
        checklistId: v.checklistId,
        number: v.number!,
        schemaVersion: (v.content as { schemaVersion?: number }).schemaVersion ?? 1,
        content: v.content,
      })),
      executions: own.map(({ x, mediaPending }) => ({
        id: x.id,
        occurrenceId: x.occurrenceId,
        checklistVersionId: x.checklistVersionId,
        state: x.state,
        rejectedReason: x.rejectedReason,
        startedAt: x.startedAt.toISOString(),
        completedAt: x.completedAt?.toISOString() ?? null,
        answers: x.answers as MyExecution['answers'],
        answersRev: x.answersRev,
        progress: x.progress as ExecutionProgress,
        late: x.late,
        clockSuspect: x.clockSuspect,
        mediaPending,
      })),
    };
  }
}

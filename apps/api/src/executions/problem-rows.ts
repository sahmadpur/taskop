import { FINAL_TASK_STATUSES, type ProblemDto, type ProblemMediaRef, type ProblemResolution, problemResolutionOf, walkItems } from '@taskop/contracts';
import { and, eq, getTableColumns, inArray, isNotNull, isNull, notInArray, type SQL } from 'drizzle-orm';
import { storedContent } from '../checklists/content';
import type { Executor } from '../db/db.service';
import { checklists, checklistVersions, executionMedia, executionProblems, executions, occurrences, sites, tasks, users } from '../db/schema';

/**
 * Problem rows with their place, executor, run state and linked task (spec §6.2 "Problem endpoints").
 * Plain functions, not a provider: the tasks module reads problem cards without importing ExecutionsModule.
 */
export function selectProblemRows(tx: Executor) {
  return tx
    .select({
      pr: getTableColumns(executionProblems),
      localDate: occurrences.localDate,
      siteName: sites.name,
      checklistName: checklists.name,
      executorName: users.fullName,
      versionId: executions.checklistVersionId,
      executionState: executions.state,
      taskId: tasks.id,
      taskStatus: tasks.status,
    })
    .from(executionProblems)
    .innerJoin(occurrences, eq(occurrences.id, executionProblems.occurrenceId))
    .innerJoin(executions, eq(executions.id, executionProblems.executionId))
    .innerJoin(users, eq(users.id, executions.executorUserId))
    .innerJoin(sites, eq(sites.id, executionProblems.siteId))
    .innerJoin(checklists, eq(checklists.id, executionProblems.checklistId))
    .leftJoin(tasks, eq(tasks.problemId, executionProblems.id))
    .$dynamic();
}
export type ProblemRow = Awaited<ReturnType<typeof selectProblemRows>>[number];

/**
 * Rows → DTOs. Item labels come from each pinned version; null if the item is not there. Media get their kind and
 * status from execution_media, in `mediaIds` order (Spec decision 24); a purged object is still `pending`.
 */
export async function toProblemDtos(tx: Executor, rows: ProblemRow[]): Promise<ProblemDto[]> {
  const mediaIds = [...new Set(rows.flatMap((r) => r.pr.mediaIds))];
  const media = mediaIds.length
    ? await tx
        .select({ id: executionMedia.id, executionId: executionMedia.executionId, kind: executionMedia.kind, status: executionMedia.status })
        .from(executionMedia)
        .where(inArray(executionMedia.id, mediaIds))
    : [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  // The answers validation only lets a problem list media of its own run; the executionId check keeps that true here.
  const refsOf = (r: ProblemRow): ProblemMediaRef[] =>
    r.pr.mediaIds.flatMap((id) => {
      const m = mediaById.get(id);
      return m && m.executionId === r.pr.executionId ? [{ id, kind: m.kind, status: m.status }] : [];
    });
  const versionIds = [...new Set(rows.map((r) => r.versionId))];
  const versions = versionIds.length
    ? await tx.select({ id: checklistVersions.id, content: checklistVersions.content }).from(checklistVersions).where(inArray(checklistVersions.id, versionIds))
    : [];
  const labels = new Map<string, Map<string, string>>();
  for (const v of versions) {
    const byItem = new Map<string, string>();
    walkItems(storedContent(v.content), (item) => byItem.set(item.id, item.label));
    labels.set(v.id, byItem);
  }
  return rows.map((r) => ({
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
    media: refsOf(r),
    executorName: r.executorName,
    createdAt: r.pr.createdAt.toISOString(),
    resolution: problemResolutionOf(r.taskStatus),
    taskId: r.taskId,
    executionState: r.executionState,
    clearedAt: null,
  }));
}

/** GET /problems?resolution=… over the left-joined task. */
export function resolutionFilter(r: ProblemResolution): SQL {
  switch (r) {
    case 'none':
      return isNull(tasks.id);
    case 'open':
      return and(isNotNull(tasks.id), notInArray(tasks.status, [...FINAL_TASK_STATUSES]))!;
    case 'resolved':
      return eq(tasks.status, 'completed');
    case 'cancelled':
      return eq(tasks.status, 'cancelled');
  }
}

import type { DeviceInfo, ExecutionMediaDto, ExecutionProblem, ExecutionProgress, ExecutionSummary, ScoreResult } from '@taskop/contracts';
import { getTableColumns, sql } from 'drizzle-orm';
import { executionMedia, executionProblems, executions, users } from '../db/schema';

/** Media of the execution in the current row not yet confirmed as uploaded (spec §6.7 `mediaPending`). */
export const mediaPendingSql = sql<number>`(select count(*)::int from execution_media m where m.execution_id = "executions"."id" and m.status = 'pending')`;
export const problemCountSql = sql<number>`(select count(*)::int from execution_problems pr where pr.execution_id = "executions"."id")`;

/** Select shape for summaries: `from(executions).innerJoin(users, executor)`. */
export const executionSummaryColumns = {
  x: getTableColumns(executions),
  executorName: users.fullName,
  problemCount: problemCountSql,
  mediaPending: mediaPendingSql,
};

export interface ExecutionSummaryRow {
  x: typeof executions.$inferSelect;
  executorName: string;
  problemCount: number;
  mediaPending: number;
}

export const toExecutionSummary = (r: ExecutionSummaryRow): ExecutionSummary => ({
  id: r.x.id,
  executor: { id: r.x.executorUserId, fullName: r.executorName },
  state: r.x.state,
  rejectedReason: r.x.rejectedReason,
  startedAt: r.x.startedAt.toISOString(),
  startedReceivedAt: r.x.startedReceivedAt.toISOString(),
  completedAt: r.x.completedAt?.toISOString() ?? null,
  completedReceivedAt: r.x.completedReceivedAt?.toISOString() ?? null,
  late: r.x.late,
  clockSuspect: r.x.clockSuspect,
  progress: r.x.progress as ExecutionProgress,
  scorePercent: (r.x.score as ScoreResult | null)?.percent ?? null,
  problemCount: r.problemCount,
  mediaPending: r.mediaPending,
});

export const toMediaDto = (r: { m: typeof executionMedia.$inferSelect; capturedByName: string }): ExecutionMediaDto => ({
  id: r.m.id,
  itemId: r.m.itemId,
  kind: r.m.kind,
  source: r.m.source,
  mime: r.m.mime,
  bytes: r.m.bytes,
  width: r.m.width,
  height: r.m.height,
  durationMs: r.m.durationMs,
  capturedAt: r.m.capturedAt.toISOString(),
  capturedBy: { id: r.m.capturedByUserId, fullName: r.capturedByName },
  status: r.m.status,
  uploadedAt: r.m.uploadedAt?.toISOString() ?? null,
});

export const toProblemEntry = (p: typeof executionProblems.$inferSelect): ExecutionProblem => ({
  id: p.id,
  itemId: p.itemId,
  source: p.source,
  severity: p.severity,
  note: p.note,
  mediaIds: p.mediaIds,
  createdAt: p.createdAt.toISOString(),
});

export const asDevice = (v: unknown): DeviceInfo => v as DeviceInfo;

import type { TaskHistoryEntry, TaskMediaDto, TaskSubmissionDto, TaskSummary } from '@taskop/contracts';
import { eq, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/db.service';
import { sites, taskMedia, taskStatusHistory, taskSubmissions, tasks, teams, users } from '../db/schema';
import type { TaskRow } from './task-scope';

const creator = alias(users, 'creator');
const assignee = alias(users, 'assignee');

export const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

/** Tasks with their site, team, creator and assignee names. */
export function selectTasks(tx: Executor) {
  return tx
    .select({
      t: getTableColumns(tasks),
      siteName: sites.name,
      teamName: teams.name,
      creatorName: creator.fullName,
      assigneeName: assignee.fullName,
      assigneeStatus: assignee.status,
    })
    .from(tasks)
    .innerJoin(creator, eq(creator.id, tasks.createdByUserId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .leftJoin(teams, eq(teams.id, tasks.assigneeTeamId))
    .leftJoin(sites, eq(sites.id, tasks.siteId))
    .$dynamic();
}
export type TaskSummaryRow = Awaited<ReturnType<typeof selectTasks>>[number];

export const toTaskSummary = (r: TaskSummaryRow): TaskSummary => ({
  id: r.t.id,
  title: r.t.title,
  priority: r.t.priority,
  status: r.t.status,
  site: r.t.siteId ? { id: r.t.siteId, name: r.siteName ?? '' } : null,
  assignee: r.t.assigneeUserId ? { id: r.t.assigneeUserId, fullName: r.assigneeName ?? '' } : null,
  team: r.t.assigneeTeamId ? { id: r.t.assigneeTeamId, name: r.teamName ?? '' } : null,
  assigneeInactive: r.t.assigneeUserId !== null && r.assigneeStatus !== 'active',
  createdBy: { id: r.t.createdByUserId, fullName: r.creatorName },
  requiresReview: r.t.requiresReview,
  source: r.t.problemId ? 'problem' : 'adhoc',
  problemId: r.t.problemId,
  dueAt: iso(r.t.dueAt),
  overdueAt: iso(r.t.overdueAt),
  rev: r.t.rev,
  createdAt: r.t.createdAt.toISOString(),
  updatedAt: r.t.updatedAt.toISOString(),
});

export const toTaskMediaDto = (r: { m: typeof taskMedia.$inferSelect; capturedByName: string }): TaskMediaDto => ({
  id: r.m.id,
  role: r.m.role,
  submissionId: r.m.submissionId,
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
  uploadedAt: iso(r.m.uploadedAt),
});

export const toSubmissionDto = (r: { s: typeof taskSubmissions.$inferSelect; submittedByName: string; reviewedByName: string | null }): TaskSubmissionDto => ({
  id: r.s.id,
  submittedBy: { id: r.s.submittedByUserId, fullName: r.submittedByName },
  text: r.s.text,
  mediaIds: r.s.mediaIds,
  submittedAt: r.s.submittedAt.toISOString(),
  receivedAt: r.s.receivedAt.toISOString(),
  reviewDecision: r.s.reviewDecision,
  reviewComment: r.s.reviewComment,
  reviewedBy: r.s.reviewedByUserId ? { id: r.s.reviewedByUserId, fullName: r.reviewedByName ?? '' } : null,
  reviewedAt: iso(r.s.reviewedAt),
});

export const toHistoryEntry = (r: { h: typeof taskStatusHistory.$inferSelect; actorName: string | null }): TaskHistoryEntry => ({
  id: r.h.id,
  fromStatus: r.h.fromStatus,
  toStatus: r.h.toStatus,
  at: r.h.at.toISOString(),
  actor: r.h.actorUserId ? { id: r.h.actorUserId, fullName: r.actorName ?? '' } : null,
  comment: r.h.comment,
});

/** The audited fields of a task (spec §6.6). */
export const auditView = (t: TaskRow) => ({
  title: t.title,
  instructions: t.instructions,
  priority: t.priority,
  siteId: t.siteId,
  assigneeUserId: t.assigneeUserId,
  assigneeTeamId: t.assigneeTeamId,
  dueAt: iso(t.dueAt),
  requiresReview: t.requiresReview,
  evidence: t.evidence,
  problemId: t.problemId,
  status: t.status,
});

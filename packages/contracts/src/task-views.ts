import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { problemDtoSchema } from './execution-views.js';
import { mediaKindSchema, mediaSourceSchema, mediaStatusSchema } from './executions.js';
import { userRefSchema } from './occurrences.js';
import { taskEvidenceSchema, taskMediaRoleSchema, taskPrioritySchema, taskReviewDecisionSchema, taskSourceSchema, taskStatusSchema } from './tasks.js';

export const taskSiteRefSchema = z.object({ id: idSchema, name: z.string() });
export const taskTeamRefSchema = z.object({ id: idSchema, name: z.string() });

/** A row of GET /tasks (spec §6.2). */
export const taskSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  site: taskSiteRefSchema.nullable(),
  /** Null while a team task waits for a member to accept it. */
  assignee: userRefSchema.nullable(),
  team: taskTeamRefSchema.nullable(),
  /** The assignee was deactivated; a manager should reassign (spec §6.5). */
  assigneeInactive: z.boolean(),
  createdBy: userRefSchema,
  requiresReview: z.boolean(),
  source: taskSourceSchema,
  problemId: idSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  /** Set by the sweep once due; completion does not clear it (spec §3). */
  overdueAt: isoDateTimeSchema.nullable(),
  rev: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskMediaDtoSchema = z.object({
  id: idSchema,
  role: taskMediaRoleSchema,
  /** The submission that lists it; null for instruction media and unsubmitted responses. */
  submissionId: idSchema.nullable(),
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  mime: z.string(),
  bytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  capturedAt: isoDateTimeSchema,
  capturedBy: userRefSchema,
  status: mediaStatusSchema,
  uploadedAt: isoDateTimeSchema.nullable(),
});
export type TaskMediaDto = z.infer<typeof taskMediaDtoSchema>;

export const taskSubmissionDtoSchema = z.object({
  id: idSchema,
  submittedBy: userRefSchema,
  text: z.string(),
  mediaIds: z.array(idSchema),
  /** Device time (bounded); receivedAt is the server's. */
  submittedAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema,
  reviewDecision: taskReviewDecisionSchema.nullable(),
  reviewComment: z.string().nullable(),
  reviewedBy: userRefSchema.nullable(),
  reviewedAt: isoDateTimeSchema.nullable(),
});
export type TaskSubmissionDto = z.infer<typeof taskSubmissionDtoSchema>;

export const taskHistoryEntrySchema = z.object({
  id: idSchema,
  fromStatus: taskStatusSchema.nullable(),
  toStatus: taskStatusSchema,
  at: isoDateTimeSchema,
  /** Null for the system (the deactivation listener). */
  actor: userRefSchema.nullable(),
  /** A reviewer's comment, a cancel reason, or a TASK_HISTORY_REASONS code. */
  comment: z.string().nullable(),
});
export type TaskHistoryEntry = z.infer<typeof taskHistoryEntrySchema>;

/** GET /tasks/:id (spec §6.2): everything the web drawer and the phone's task screen show. */
export const taskDetailSchema = taskSummarySchema.extend({
  instructions: z.string(),
  evidence: taskEvidenceSchema,
  acceptedAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  submittedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
  /** Instruction and response media, by capture time. */
  media: z.array(taskMediaDtoSchema),
  /** Oldest first; every submission is kept (FR-14.10 groundwork). */
  submissions: z.array(taskSubmissionDtoSchema),
  /** The source problem of a task created from one. */
  problem: problemDtoSchema.nullable(),
  history: z.array(taskHistoryEntrySchema),
  /** The caller may edit, reassign and cancel (spec §6.1). */
  canManage: z.boolean(),
  /** The caller may approve or reject. */
  canReview: z.boolean(),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

/** The phone's copy of a task in GET /me/sync (spec §6.4): no history, no caller rights. */
export const syncTaskSchema = taskDetailSchema.omit({ history: true, canManage: true, canReview: true });
export type SyncTask = z.infer<typeof syncTaskSchema>;

/** GET /tasks/assignees: the person-or-team picker. */
export const taskAssigneeOptionsSchema = z.object({
  users: z.array(z.object({ id: idSchema, fullName: z.string(), jobTitle: z.string().nullable(), kind: z.enum(['worker', 'staff']) })),
  teams: z.array(z.object({ id: idSchema, name: z.string(), memberCount: z.number().int() })),
  /** Active sites the caller may put on a task (Spec decision 25); not filtered by `q`. */
  sites: z.array(taskSiteRefSchema),
});
export type TaskAssigneeOptions = z.infer<typeof taskAssigneeOptionsSchema>;

import { z } from 'zod';
import { EVIDENCE_LEVELS } from './checklist-content.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { MEDIA_KINDS, type MediaKind, mediaKindSchema, mediaSourceSchema } from './executions.js';

/** Spec §3. `completed` and `cancelled` are final: nothing leaves them. */
export const TASK_STATUSES = ['new', 'accepted', 'in_progress', 'awaiting_review', 'completed', 'cancelled'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const FINAL_TASK_STATUSES = ['completed', 'cancelled'] as const satisfies readonly TaskStatus[];
export const isFinalTaskStatus = (s: TaskStatus): boolean => (FINAL_TASK_STATUSES as readonly TaskStatus[]).includes(s);

export const TASK_PRIORITIES = ['normal', 'high'] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const TASK_ACTIONS = ['accept', 'start', 'submit', 'approve', 'reject', 'cancel', 'reassign'] as const;
export const taskActionSchema = z.enum(TASK_ACTIONS);
export type TaskAction = z.infer<typeof taskActionSchema>;

export const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS);

export const taskEvidenceSchema = z.object({ photo: evidenceLevelSchema, video: evidenceLevelSchema, liveOnly: z.boolean() });
export type TaskEvidence = z.infer<typeof taskEvidenceSchema>;
export const DEFAULT_TASK_EVIDENCE: TaskEvidence = { photo: 'optional', video: 'optional', liveOnly: false };

export const TASK_MEDIA_ROLES = ['instruction', 'response'] as const;
export const taskMediaRoleSchema = z.enum(TASK_MEDIA_ROLES);
export type TaskMediaRole = z.infer<typeof taskMediaRoleSchema>;

/** Stored on a submission once reviewed. */
export const TASK_REVIEW_DECISIONS = ['approved', 'rejected'] as const;
export const taskReviewDecisionSchema = z.enum(TASK_REVIEW_DECISIONS);
export type TaskReviewDecision = z.infer<typeof taskReviewDecisionSchema>;

export const TASK_SOURCES = ['problem', 'adhoc'] as const;
export const taskSourceSchema = z.enum(TASK_SOURCES);
export type TaskSource = z.infer<typeof taskSourceSchema>;

/** A problem's resolution, derived from its task (spec §5). The strings are also i18n keys under tasks.resolutions. */
export const PROBLEM_RESOLUTIONS = ['none', 'open', 'resolved', 'cancelled'] as const;
export const problemResolutionSchema = z.enum(PROBLEM_RESOLUTIONS);
export type ProblemResolution = z.infer<typeof problemResolutionSchema>;

/** History comments the system writes; reviewers' comments and cancel reasons are free text. */
export const TASK_HISTORY_REASONS = ['assignee_deactivated'] as const;
export type TaskHistoryReason = (typeof TASK_HISTORY_REASONS)[number];

/** Spec §4. File sizes, types and resizing are MEDIA_LIMITS. */
export const TASK_LIMITS = {
  titleMax: 200,
  instructionsMax: 5000,
  submissionTextMax: 5000,
  /** Cancel reason and review comment. */
  commentMax: 1000,
  instructionMedia: 5,
  responsePhotos: 10,
  responseVideos: 3,
  /** Closed tasks stay on the phone this long after closing (spec §6.4). */
  syncClosedDays: 7,
  /** Known task ids the phone sends to /me/sync; 100 keeps the URL well under Node's header limit. */
  knownTaskIds: 100,
} as const;

export const TASK_ISSUE_CODES = [
  'tasks.issues.commentRequired',
  'tasks.issues.unknownMedia',
  'tasks.issues.tooManyMedia',
  'tasks.issues.photoRequired',
  'tasks.issues.videoRequired',
] as const;
export type TaskIssueCode = (typeof TASK_ISSUE_CODES)[number];

/** 'submitted' resolves to awaiting_review or completed by the task's review setting. */
const MOVES: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus | 'submitted'>>> = {
  new: { accept: 'accepted', start: 'in_progress', cancel: 'cancelled', reassign: 'new' },
  accepted: { start: 'in_progress', cancel: 'cancelled', reassign: 'new' },
  in_progress: { submit: 'submitted', cancel: 'cancelled', reassign: 'new' },
  awaiting_review: { approve: 'completed', reject: 'in_progress', cancel: 'cancelled', reassign: 'new' },
  completed: {},
  cancelled: {},
};

/** The spec §3 status table: the next status, or null when the action is refused. Shared by the phone and the API. */
export function taskTransition(status: TaskStatus, action: TaskAction, opts: { requiresReview: boolean }): TaskStatus | null {
  const next = MOVES[status][action];
  if (next === undefined) return null;
  if (next === 'submitted') return opts.requiresReview ? 'awaiting_review' : 'completed';
  return next;
}

export type TaskEvidenceResult = { ok: true } | { ok: false; missing: MediaKind[] };

/** FR-12.01–02: a required kind needs at least one medium of that kind in the submission. */
export function taskEvidenceMet(evidence: TaskEvidence, media: ReadonlyArray<{ kind: MediaKind }>): TaskEvidenceResult {
  const missing = MEDIA_KINDS.filter((k) => evidence[k] === 'required' && !media.some((m) => m.kind === k));
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Spec §5: no task → none; task not final → open; completed → resolved; cancelled → cancelled. */
export function problemResolutionOf(taskStatus: TaskStatus | null): ProblemResolution {
  if (taskStatus === null) return 'none';
  if (taskStatus === 'completed') return 'resolved';
  if (taskStatus === 'cancelled') return 'cancelled';
  return 'open';
}

/** A person or a team, exactly one (spec §4). */
export const taskAssigneeSchema = z.union([z.strictObject({ userId: idSchema }), z.strictObject({ teamId: idSchema })]);
export type TaskAssignee = z.infer<typeof taskAssigneeSchema>;

const titleSchema = z.string().trim().min(1).max(TASK_LIMITS.titleMax);
const instructionsSchema = z.string().trim().max(TASK_LIMITS.instructionsMax);

export const createTaskSchema = z.object({
  /** Client-generated UUIDv7: repeating the request returns the stored task. */
  id: idSchema,
  title: titleSchema,
  instructions: instructionsSchema.default(''),
  priority: taskPrioritySchema.default('normal'),
  /** Ignored when problemId is given: the problem's site is used. */
  siteId: idSchema.nullable().default(null),
  dueAt: isoDateTimeSchema.nullable().default(null),
  evidence: taskEvidenceSchema.default(() => ({ ...DEFAULT_TASK_EVIDENCE })),
  /** Defaults to true for a task created from a problem, false otherwise (spec §1). */
  requiresReview: z.boolean().optional(),
  assignee: taskAssigneeSchema,
  problemId: idSchema.nullable().default(null),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

/** Changing `assignee` reassigns: back to `new` (spec §3). */
export const updateTaskSchema = z.object({
  title: titleSchema.optional(),
  instructions: instructionsSchema.optional(),
  priority: taskPrioritySchema.optional(),
  siteId: idSchema.nullable().optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  evidence: taskEvidenceSchema.optional(),
  requiresReview: z.boolean().optional(),
  assignee: taskAssigneeSchema.optional(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const cancelTaskSchema = z.object({ reason: z.string().trim().min(1).max(TASK_LIMITS.commentMax) });
export type CancelTaskInput = z.input<typeof cancelTaskSchema>;

export const reviewTaskSchema = z
  .object({ decision: z.enum(['approve', 'reject']), comment: z.string().trim().max(TASK_LIMITS.commentMax).optional() })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && !v.comment) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'tasks.issues.commentRequired' });
  });
export type ReviewTaskInput = z.input<typeof reviewTaskSchema>;

/** Accept and start carry the device time of the tap (spec §6.3). */
export const taskActionCommandSchema = z.object({ at: isoDateTimeSchema });
export type TaskActionCommand = z.input<typeof taskActionCommandSchema>;

export const submissionSchema = z.object({
  /** Client-generated UUIDv7: the command is idempotent on it. */
  id: idSchema,
  text: z.string().trim().max(TASK_LIMITS.submissionTextMax).default(''),
  /** Registered response media of this task; per kind ≤ responsePhotos / responseVideos (checked by the API). */
  mediaIds: z.array(idSchema).max(TASK_LIMITS.responsePhotos + TASK_LIMITS.responseVideos).default([]),
  submittedAt: isoDateTimeSchema,
});
export type SubmissionInput = z.input<typeof submissionSchema>;

export const taskMediaRegisterSchema = z.object({
  id: idSchema,
  role: taskMediaRoleSchema,
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  mime: z.string().max(100),
  bytes: z.number().int().min(1),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  capturedAt: isoDateTimeSchema,
});
export type TaskMediaRegisterInput = z.input<typeof taskMediaRegisterSchema>;

/** `status=new,in_progress` in the query string. */
const statusList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(taskStatusSchema).min(1));

export const taskListQuerySchema = cursorQuerySchema.extend({
  status: statusList.optional(),
  overdue: z.stringbool().optional(),
  siteId: idSchema.optional(),
  assigneeUserId: idSchema.optional(),
  teamId: idSchema.optional(),
  createdBy: idSchema.optional(),
  source: taskSourceSchema.optional(),
  /** Tasks in awaiting_review that the caller may review. */
  awaitingMyReview: z.stringbool().optional(),
  dueFrom: isoDateTimeSchema.optional(),
  dueTo: isoDateTimeSchema.optional(),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

export const taskAssigneeQuerySchema = z.object({ q: z.string().trim().max(100).optional() });
export type TaskAssigneeQuery = z.input<typeof taskAssigneeQuerySchema>;

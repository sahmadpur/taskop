import { z } from 'zod';
import { checklistContentSchema } from './checklist-content.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, problemSeveritySchema, problemSourceSchema, progressSchema, scoreSchema } from './execution-logic.js';
import { executionSummarySchema } from './execution-summary.js';
import { answerSchema, claimRefSchema, deviceInfoSchema, EXECUTION_LIMITS, mediaKindSchema, mediaSourceSchema, mediaStatusSchema } from './executions.js';
import { occurrenceDtoSchema, occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, localDateSchema } from './scheduling-time.js';
import { problemResolutionSchema } from './tasks.js';

export const syncOccurrenceSchema = z.object({
  id: idSchema,
  checklistId: idSchema,
  checklistName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  shiftName: z.string().nullable(),
  localDate: localDateSchema,
  startsAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
  closesAt: isoDateTimeSchema,
  status: occurrenceStatusSchema,
  /** Pinned at the first download or claim; never changes afterwards (spec §5.1). */
  checklistVersionId: idSchema,
  claim: claimRefSchema.nullable(),
});
export type SyncOccurrence = z.infer<typeof syncOccurrenceSchema>;

/** `content` stays opaque so an old app can still sync and then refuse a newer `schemaVersion` ("Tətbiqi yeniləyin"). */
export const syncChecklistVersionSchema = z.object({
  id: idSchema,
  checklistId: idSchema,
  number: z.number().int(),
  schemaVersion: z.number().int(),
  content: z.unknown(),
});
export type SyncChecklistVersion = z.infer<typeof syncChecklistVersionSchema>;

const storedAnswersSchema = z.record(z.string(), answerSchema);

export const myExecutionSchema = z.object({
  id: idSchema,
  occurrenceId: idSchema,
  checklistVersionId: idSchema,
  state: executionStateSchema,
  rejectedReason: claimRejectionReasonSchema.nullable(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  answers: storedAnswersSchema,
  answersRev: z.number().int(),
  progress: progressSchema,
  late: z.boolean(),
  clockSuspect: z.boolean(),
  mediaPending: z.number().int(),
});
export type MyExecution = z.infer<typeof myExecutionSchema>;

export const executionMediaDtoSchema = z.object({
  id: idSchema,
  itemId: idSchema.nullable(),
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
export type ExecutionMediaDto = z.infer<typeof executionMediaDtoSchema>;

export const executionProblemSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  source: problemSourceSchema,
  severity: problemSeveritySchema,
  note: z.string().nullable(),
  mediaIds: z.array(idSchema),
  createdAt: isoDateTimeSchema,
  resolution: problemResolutionSchema,
  /** The task created from this problem (spec §6.2 "Problem endpoints"). */
  taskId: idSchema.nullable(),
});
export type ExecutionProblem = z.infer<typeof executionProblemSchema>;

export const executionDetailSchema = executionSummarySchema.extend({
  occurrence: occurrenceDtoSchema,
  checklistVersionId: idSchema,
  versionNumber: z.number().int(),
  content: checklistContentSchema,
  answers: storedAnswersSchema,
  answersRev: z.number().int(),
  score: scoreSchema.nullable(),
  clockOffsetMs: z.number().int().nullable(),
  device: deviceInfoSchema,
  lastSyncedAt: isoDateTimeSchema,
  media: z.array(executionMediaDtoSchema),
  problems: z.array(executionProblemSchema),
});
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;

/** A problem medium as the apps draw it (Spec decision 24). A purged object keeps `pending`. */
export const problemMediaRefSchema = z.object({ id: idSchema, kind: mediaKindSchema, status: mediaStatusSchema });
export type ProblemMediaRef = z.infer<typeof problemMediaRefSchema>;

export const problemDtoSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  occurrenceId: idSchema,
  localDate: localDateSchema,
  siteId: idSchema,
  siteName: z.string(),
  checklistId: idSchema,
  checklistName: z.string(),
  itemId: idSchema,
  /** From the pinned version; null if the item cannot be found there. */
  itemLabel: z.string().nullable(),
  source: problemSourceSchema,
  severity: problemSeveritySchema,
  note: z.string().nullable(),
  mediaIds: z.array(idSchema),
  /** The same media as `mediaIds`, in that order, with kind and upload status (Spec decision 24). */
  media: z.array(problemMediaRefSchema),
  executorName: z.string(),
  createdAt: isoDateTimeSchema,
  resolution: problemResolutionSchema,
  taskId: idSchema.nullable(),
  /** `active` = the run is still open: no task can be created from the problem yet (PROBLEM_NOT_CLOSED). */
  executionState: executionStateSchema,
});
export type ProblemDto = z.infer<typeof problemDtoSchema>;

export const problemListQuerySchema = cursorQuerySchema
  .extend({
    from: localDateSchema,
    to: localDateSchema,
    siteId: idSchema.optional(),
    checklistId: idSchema.optional(),
    severity: problemSeveritySchema.optional(),
    source: problemSourceSchema.optional(),
    resolution: problemResolutionSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > EXECUTION_LIMITS.problemsMaxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'executions.issues.rangeTooLong' });
  });
export type ProblemListQuery = z.input<typeof problemListQuerySchema>;

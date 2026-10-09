import { z } from 'zod';
import { checklistContentSchema } from './checklist-content.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, problemSeveritySchema, problemSourceSchema, progressSchema, scoreSchema } from './execution-logic.js';
import { executionSummarySchema } from './execution-summary.js';
import { answerSchema, claimRefSchema, deviceInfoSchema, EXECUTION_LIMITS, mediaKindSchema, mediaSourceSchema, mediaStatusSchema } from './executions.js';
import { occurrenceDtoSchema, occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, localDateSchema } from './scheduling-time.js';

/** `knownVersionIds=a,b` in the query string: versions the phone already holds. */
export const syncQuerySchema = z.object({
  knownVersionIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(idSchema).max(200)),
});
export type SyncQuery = z.input<typeof syncQuerySchema>;

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

export const syncResponseSchema = z.object({
  serverTime: isoDateTimeSchema,
  occurrences: z.array(syncOccurrenceSchema),
  checklistVersions: z.array(syncChecklistVersionSchema),
  executions: z.array(myExecutionSchema),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

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
  executorName: z.string(),
  createdAt: isoDateTimeSchema,
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
  })
  .superRefine((v, ctx) => {
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > EXECUTION_LIMITS.problemsMaxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'executions.issues.rangeTooLong' });
  });
export type ProblemListQuery = z.input<typeof problemListQuerySchema>;

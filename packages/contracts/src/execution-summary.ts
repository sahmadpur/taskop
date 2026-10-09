import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, progressSchema } from './execution-logic.js';

/** The counted execution of an occurrence, for list rows (spec §8 badges and columns). */
export const executionBriefSchema = z.object({
  executionId: idSchema,
  executorName: z.string(),
  state: executionStateSchema,
  progress: progressSchema,
  scorePercent: z.number().nullable(),
  late: z.boolean(),
  clockSuspect: z.boolean(),
});
export type ExecutionBrief = z.infer<typeof executionBriefSchema>;

/** One execution of an occurrence, counted or rejected (spec §6.8). Device times first, server receipt beside them. */
export const executionSummarySchema = z.object({
  id: idSchema,
  executor: z.object({ id: idSchema, fullName: z.string() }),
  state: executionStateSchema,
  rejectedReason: claimRejectionReasonSchema.nullable(),
  startedAt: isoDateTimeSchema,
  startedReceivedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  completedReceivedAt: isoDateTimeSchema.nullable(),
  late: z.boolean(),
  clockSuspect: z.boolean(),
  progress: progressSchema,
  scorePercent: z.number().nullable(),
  problemCount: z.number().int(),
  mediaPending: z.number().int(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

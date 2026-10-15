import { z } from 'zod';
import { AUDIT_LIMITS, correctionKindSchema } from './audit-logic.js';
import { idSchema, isoDateTimeSchema } from './common.js';
import { executionStateSchema, progressSchema, scoreSchema } from './execution-logic.js';
import { answerSchema } from './executions.js';
import { occurrenceStatusSchema, userRefSchema } from './occurrences.js';

/** Field keys of correction validation errors; also i18n keys. */
export const CORRECTION_ISSUE_CODES = ['corrections.issues.dueInPast', 'corrections.issues.duplicateItem'] as const;
export type CorrectionIssueCode = (typeof CORRECTION_ISSUE_CODES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

/** One issue per repeated item id, at `<list>.<index>.itemId`. */
const uniqueItems =
  <K extends string>(list: K) =>
  (v: Record<K, { itemId: string }[]>, ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    v[list].forEach((x, i) => {
      if (seen.has(x.itemId)) ctx.addIssue({ code: 'custom', path: [list, i, 'itemId'], message: 'corrections.issues.duplicateItem' });
      seen.add(x.itemId);
    });
  };

/** Spec decision 2: everything a worker's answer holds except the manual problem, which a correction never edits. */
export const correctionAnswerSchema = answerSchema.omit({ problem: true });
export type CorrectionAnswer = z.infer<typeof correctionAnswerSchema>;

/** POST /executions/:id/corrections. `answer: null` clears the item (its manual problem stays). */
export const correctAnswersInputSchema = z
  .object({
    answersRev: z.number().int().min(1),
    changes: z.array(z.object({ itemId: idSchema, answer: correctionAnswerSchema.nullable() })).min(1).max(AUDIT_LIMITS.changes),
    reason: text(AUDIT_LIMITS.reason),
  })
  .superRefine(uniqueItems('changes'));
export type CorrectAnswersInput = z.input<typeof correctAnswersInputSchema>;
export type CorrectAnswersParams = z.output<typeof correctAnswersInputSchema>;

export const correctionResultSchema = z.object({
  executionId: idSchema,
  /** The stored revision after the correction (unchanged when nothing changed). */
  answersRev: z.number().int(),
  changedItemIds: z.array(idSchema),
  score: scoreSchema.nullable(),
});
export type CorrectionResult = z.infer<typeof correctionResultSchema>;

export const reworkItemSchema = z.object({ itemId: idSchema, comment: text(AUDIT_LIMITS.reason) });
export type ReworkItem = z.infer<typeof reworkItemSchema>;

/** POST /executions/:id/send-back. A `dueAt` in the past is refused by the API (`corrections.issues.dueInPast`). */
export const sendBackInputSchema = z
  .object({
    items: z.array(reworkItemSchema).min(1).max(AUDIT_LIMITS.reworkItems),
    dueAt: isoDateTimeSchema.nullable().optional(),
  })
  .superRefine(uniqueItems('items'));
export type SendBackInput = z.input<typeof sendBackInputSchema>;
export type SendBackParams = z.output<typeof sendBackInputSchema>;

export const reworkRequestSchema = z.object({
  id: idSchema,
  round: z.number().int(),
  items: z.array(reworkItemSchema),
  /** Informational: nothing happens when it passes (spec §3.2). */
  dueAt: isoDateTimeSchema.nullable(),
  /** null = a platform admin (Taskop support) sent it back. */
  requestedBy: userRefSchema.nullable(),
  requestedAt: isoDateTimeSchema,
  resubmittedAt: isoDateTimeSchema.nullable(),
  withdrawnAt: isoDateTimeSchema.nullable(),
  withdrawnBy: userRefSchema.nullable(),
  /** The answers when the run was sent back: the base of the rework guard (reworkViolations), so the phone starts from it. */
  answersBefore: z.record(z.string(), answerSchema),
});
export type ReworkRequest = z.infer<typeof reworkRequestSchema>;

export const correctionActorSchema = z.object({ kind: z.enum(['user', 'platform']), name: z.string().nullable() });
export type CorrectionActor = z.infer<typeof correctionActorSchema>;

/** One changed item (FR-19.13): who, when, which item, old and new value, and why. */
export const correctionSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  kind: correctionKindSchema,
  round: z.number().int(),
  before: answerSchema.nullable(),
  after: answerSchema.nullable(),
  /** manual: the manager's reason; rework: the manager's comment on the item. */
  reason: z.string(),
  actor: correctionActorSchema,
  at: isoDateTimeSchema,
});
export type Correction = z.infer<typeof correctionSchema>;

export const answerDiffSchema = z.object({ itemId: idSchema, original: answerSchema.nullable(), current: answerSchema.nullable() });
export type AnswerDiff = z.infer<typeof answerDiffSchema>;

/** GET /executions/:id/corrections (NFR-07.05). */
export const executionCorrectionsSchema = z.object({
  /** The one-time snapshot; null until the first correction or send-back. */
  original: z.object({ answers: z.record(z.string(), answerSchema), score: scoreSchema.nullable(), capturedAt: isoDateTimeSchema }).nullable(),
  /** Oldest first. */
  corrections: z.array(correctionSchema),
  /** Round order. */
  reworkRequests: z.array(reworkRequestSchema),
  /** Items whose current answer differs from the original, in checklist order. */
  diff: z.array(answerDiffSchema),
});
export type ExecutionCorrections = z.infer<typeof executionCorrectionsSchema>;

/** POST /executions/:id/resubmit: the device time of the tap, with the usual command timing (spec §6.6 of SP4). */
export const resubmitCommandSchema = z.object({
  resubmittedAt: isoDateTimeSchema,
  deviceTime: isoDateTimeSchema,
  clientOffsetMs: z.number().int().min(-2_000_000_000).max(2_000_000_000),
});
export type ResubmitCommand = z.input<typeof resubmitCommandSchema>;

export const resubmitResultSchema = z.object({
  executionId: idSchema,
  state: executionStateSchema,
  status: occurrenceStatusSchema,
  progress: progressSchema,
  score: scoreSchema.nullable(),
});
export type ResubmitResult = z.infer<typeof resubmitResultSchema>;

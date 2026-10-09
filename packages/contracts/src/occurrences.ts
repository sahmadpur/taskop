import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { executionBriefSchema, executionSummarySchema } from './execution-summary.js';
import { localDateSchema } from './scheduling-time.js';
import { localRangeCheck, SCHEDULING_LIMITS } from './scheduling.js';

/** FR-11.01. Sub-project 3 writes pending, overdue, missed and cancelled; the rest belong to sub-project 4. */
export const OCCURRENCE_STATUSES = ['pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited'] as const;
export const occurrenceStatusSchema = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatus = z.infer<typeof occurrenceStatusSchema>;

/** Reasons the system records when it cancels occurrences; a manager's own reason is free text. */
export const CANCEL_REASON_CODES = ['assignment_edited', 'assignment_paused', 'assignment_ended', 'checklist_deactivated', 'shift_changed'] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export const userRefSchema = z.object({ id: idSchema, fullName: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

export const occurrenceDtoSchema = z.object({
  id: idSchema,
  assignmentId: idSchema,
  assignmentName: z.string().nullable(),
  checklistId: idSchema,
  checklistName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  shiftId: idSchema.nullable(),
  shiftName: z.string().nullable(),
  localDate: localDateSchema,
  startsAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
  closesAt: isoDateTimeSchema,
  status: occurrenceStatusSchema,
  statusChangedAt: isoDateTimeSchema,
  cancelReason: z.string().nullable(),
  assigneeIds: z.array(idSchema),
  /** Pending or overdue with nobody eligible (spec §5.3). */
  unassigned: z.boolean(),
  /** The counted execution (not rejected), or null (SP4 spec §8). */
  executionBrief: executionBriefSchema.nullable(),
});
export type OccurrenceDto = z.infer<typeof occurrenceDtoSchema>;

export const occurrenceHistoryEntrySchema = z.object({
  fromStatus: occurrenceStatusSchema.nullable(),
  toStatus: occurrenceStatusSchema,
  at: isoDateTimeSchema,
  actor: z.object({ kind: z.enum(['user', 'platform', 'system']), name: z.string().nullable() }),
  reason: z.string().nullable(),
});
export type OccurrenceHistoryEntry = z.infer<typeof occurrenceHistoryEntrySchema>;

export const occurrenceDetailSchema = occurrenceDtoSchema.extend({
  assignees: z.array(userRefSchema),
  history: z.array(occurrenceHistoryEntrySchema),
  /** The counted execution (SP4 spec §6.8). */
  execution: executionSummarySchema.nullable(),
  /** Executions whose claim lost; stored, never counted. */
  rejectedExecutions: z.array(executionSummarySchema),
});
export type OccurrenceDetail = z.infer<typeof occurrenceDetailSchema>;

/** `status=pending,overdue` in the query string. */
const statusList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(occurrenceStatusSchema).min(1));

export const occurrenceListQuerySchema = cursorQuerySchema
  .extend({
    from: localDateSchema,
    to: localDateSchema,
    siteId: idSchema.optional(),
    status: statusList.optional(),
    assigneeId: idSchema.optional(),
    checklistId: idSchema.optional(),
    assignmentId: idSchema.optional(),
  })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.maxListDays));
export type OccurrenceListQuery = z.input<typeof occurrenceListQuerySchema>;

export const myOccurrenceQuerySchema = cursorQuerySchema
  .extend({ from: localDateSchema, to: localDateSchema, status: statusList.optional() })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.maxListDays));
export type MyOccurrenceQuery = z.input<typeof myOccurrenceQuerySchema>;

export const cancelOccurrenceInputSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type CancelOccurrenceInput = z.input<typeof cancelOccurrenceInputSchema>;

import { z } from 'zod';
import {
  AUDIT_LIMITS,
  auditQueueSchema,
  auditReportStatusSchema,
  auditResultSchema,
  auditScoreSchema,
  auditStatusSchema,
  auditVerdictSchema,
  emailListSchema,
  runAuditStateSchema,
} from './audit-logic.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema, pageOf } from './common.js';
import { executionCorrectionsSchema } from './corrections.js';
import { executionDetailSchema } from './execution-views.js';
import { occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, type LocalDate, localDateSchema } from './scheduling-time.js';

/** Field keys of audit validation errors; also i18n keys. */
export const AUDIT_ISSUE_CODES = ['audits.issues.commentRequired', 'audits.issues.rangeTooLong', 'audits.issues.tooManyEmails', 'audits.issues.notAuditable'] as const;
export type AuditIssueCode = (typeof AUDIT_ISSUE_CODES)[number];

export const auditActorSchema = z.object({ kind: z.enum(['user', 'platform']), id: idSchema.nullable(), name: z.string().nullable() });
export type AuditActor = z.infer<typeof auditActorSchema>;

export const auditItemVerdictSchema = z.object({
  itemId: idSchema,
  verdict: auditVerdictSchema,
  comment: z.string().nullable(),
  /** null = a platform admin. */
  updatedBy: userRefSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type AuditItemVerdict = z.infer<typeof auditItemVerdictSchema>;

export const auditDtoSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  occurrenceId: idSchema,
  status: auditStatusSchema,
  /** In progress while the run is sent back: verdicts can change, finish is refused (spec §3.3). */
  paused: z.boolean(),
  auditor: auditActorSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
  result: auditResultSchema.nullable(),
  score: auditScoreSchema.nullable(),
  comment: z.string().nullable(),
  reportStatus: auditReportStatusSchema,
  reportRecipients: z.array(z.string()),
  reportSentAt: isoDateTimeSchema.nullable(),
  verdicts: z.array(auditItemVerdictSchema),
});
export type AuditDto = z.infer<typeof auditDtoSchema>;

/** GET /audits/:id: the audit with everything the audit screen shows (spec §8.3). */
export const auditDetailSchema = auditDtoSchema.extend({
  execution: executionDetailSchema,
  corrections: executionCorrectionsSchema,
  /** visibleItems of the current answers, in checklist order (Spec decision 1). */
  auditableItemIds: z.array(idSchema),
  checklistReportEmails: z.array(z.string()),
  requiresAudit: z.boolean(),
});
export type AuditDetail = z.infer<typeof auditDetailSchema>;

/** GET /audits (Spec decision 13). `from` and `to` filter the run's local day and go together. */
export const auditQueueQuerySchema = cursorQuerySchema
  .extend({
    queue: auditQueueSchema,
    siteId: idSchema.optional(),
    checklistId: idSchema.optional(),
    auditorId: idSchema.optional(),
    result: auditResultSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.from === undefined && v.to === undefined) return;
    if (v.from === undefined || v.to === undefined) {
      ctx.addIssue({ code: 'custom', path: [v.from === undefined ? 'from' : 'to'], message: 'errors.validation.required' });
      return;
    }
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > AUDIT_LIMITS.queueMaxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'audits.issues.rangeTooLong' });
  });
export type AuditQueueQuery = z.input<typeof auditQueueQuerySchema>;
export type AuditQueueParams = z.output<typeof auditQueueQuerySchema>;

const refSchema = z.object({ id: idSchema, name: z.string() });

export const auditQueueRowSchema = z.object({
  occurrenceId: idSchema,
  executionId: idSchema,
  /** null in the Waiting tab. */
  auditId: idSchema.nullable(),
  checklist: refSchema,
  site: refSchema,
  executor: userRefSchema,
  localDate: localDateSchema,
  completedAt: isoDateTimeSchema,
  status: occurrenceStatusSchema,
  auditState: runAuditStateSchema.nullable(),
  auditor: auditActorSchema.nullable(),
  result: auditResultSchema.nullable(),
  percent: z.number().nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type AuditQueueRow = z.infer<typeof auditQueueRowSchema>;
export const auditQueuePageSchema = pageOf(auditQueueRowSchema);

/** PUT /audits/:id/items/:itemId. A rejection needs a comment (FR-19.05). */
export const auditVerdictInputSchema = z
  .object({ verdict: auditVerdictSchema, comment: z.string().trim().max(AUDIT_LIMITS.verdictComment).nullable().optional() })
  .superRefine((v, ctx) => {
    if (v.verdict === 'rejected' && !v.comment) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'audits.issues.commentRequired' });
  });
export type AuditVerdictInput = z.input<typeof auditVerdictInputSchema>;
export type AuditVerdictParams = z.output<typeof auditVerdictInputSchema>;

const emailList = (min: number) => emailListSchema(AUDIT_LIMITS.recipients, min);

export const finishAuditInputSchema = z.object({
  result: auditResultSchema,
  comment: z.string().trim().max(AUDIT_LIMITS.finalComment).nullable().optional(),
  extraEmails: emailList(0).optional(),
});
export type FinishAuditInput = z.input<typeof finishAuditInputSchema>;
export type FinishAuditParams = z.output<typeof finishAuditInputSchema>;

export const cancelAuditInputSchema = z.object({ reason: z.string().trim().min(1).max(AUDIT_LIMITS.cancelReason) });
export type CancelAuditInput = z.input<typeof cancelAuditInputSchema>;

/** POST /audits/:id/report/send. Without `emails`, the stored recipients. */
export const sendAuditReportInputSchema = z.object({ emails: emailList(1).optional() });
export type SendAuditReportInput = z.input<typeof sendAuditReportInputSchema>;
export type SendAuditReportParams = z.output<typeof sendAuditReportInputSchema>;

export const AUDIT_REPORT_CONTENT_TYPE = 'application/pdf';

const TRANSLIT: Record<string, string> = { ə: 'e', ı: 'i', ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u' };

/** `taskop-audit-<ascii slug>-<YYYY-MM-DD>.pdf`. Both İ and I become i before lower-casing, so no runtime locale is needed. */
export function auditReportFileName(checklistName: string, localDate: LocalDate): string {
  const slug = checklistName
    .replace(/[İI]/g, 'i')
    .toLowerCase()
    .replace(/[əışçğöü]/g, (c) => TRANSLIT[c]!)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `taskop-audit-${slug || 'checklist'}-${localDate}.pdf`;
}

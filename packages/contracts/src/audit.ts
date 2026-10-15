import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';

export const auditEntryDtoSchema = z.object({
  id: idSchema,
  actor: z.object({
    type: z.enum(['user', 'platform_admin', 'system']),
    id: idSchema.nullable(),
    name: z.string().nullable(),
  }),
  action: z.string(),
  entityType: z.string(),
  entityId: idSchema.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type AuditEntryDto = z.infer<typeof auditEntryDtoSchema>;

export const auditListQuerySchema = cursorQuerySchema.extend({
  actorUserId: idSchema.optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(50).optional(),
  entityId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type AuditListQuery = z.input<typeof auditListQuerySchema>;

/** Audited task actions (spec §6.6), entity type `task`. Accept, start and submit go to task_status_history only. */
export const TASK_AUDIT_ACTIONS = ['task.created', 'task.updated', 'task.reassigned', 'task.cancelled', 'task.approved', 'task.rejected'] as const;
export type TaskAuditAction = (typeof TASK_AUDIT_ACTIONS)[number];

/**
 * Audited notification actions (spec §4). `notification_rule.*` use entity type `notification_rule` with a null entity id and
 * `{ type, … }` in before/after; `notification.message_sent` uses entity type `notification_message`, entity id = the event id.
 */
export const NOTIFICATION_AUDIT_ACTIONS = ['notification_rule.updated', 'notification_rule.reset', 'notification.message_sent'] as const;
export type NotificationAuditAction = (typeof NOTIFICATION_AUDIT_ACTIONS)[number];

/** Audited report action (SP7 spec §5.4): entity type `report`, entity id null, `after: { kind, format, filters, rows }`. */
export const REPORT_AUDIT_ACTIONS = ['reports.exported'] as const;
export type ReportAuditAction = (typeof REPORT_AUDIT_ACTIONS)[number];

/**
 * Audited audit and correction actions (SP8 spec §6.4). `audit.*` use entity type `audit`; `execution.*` entity type
 * `execution`. before/after hold only the changed items. Verdict edits and the system's completed → audit_pending move
 * are recorded only in their own tables and in the status history.
 */
export const AUDIT_FLOW_AUDIT_ACTIONS = [
  'audit.started',
  'audit.finished',
  'audit.cancelled',
  'audit.report_sent',
  'execution.corrected',
  'execution.sent_back',
  'execution.send_back_withdrawn',
  'execution.resubmitted',
] as const;
export type AuditFlowAuditAction = (typeof AUDIT_FLOW_AUDIT_ACTIONS)[number];

import { type AuditActor, type AuditDto, type AuditItemVerdict, type AuditScore, isAuditPaused, type OccurrenceStatus } from '@taskop/contracts';
import type { audits } from '../db/schema';

export type AuditRow = typeof audits.$inferSelect;

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

/** A user auditor, or a platform admin (Spec decision 17). */
export const auditorOf = (userId: string | null, name: string | null): AuditActor => (userId ? { kind: 'user', id: userId, name } : { kind: 'platform', id: null, name: null });

export function toAuditDto(r: AuditRow, auditorName: string | null, occurrenceStatus: OccurrenceStatus, verdicts: AuditItemVerdict[]): AuditDto {
  return {
    id: r.id,
    executionId: r.executionId,
    occurrenceId: r.occurrenceId,
    status: r.status,
    paused: r.status === 'in_progress' && isAuditPaused(occurrenceStatus),
    auditor: auditorOf(r.auditorUserId, auditorName),
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    cancelledAt: iso(r.cancelledAt),
    cancelReason: r.cancelReason,
    result: r.result,
    score: (r.auditScore as AuditScore | null) ?? null,
    comment: r.comment,
    reportStatus: r.reportStatus,
    reportRecipients: r.reportRecipients,
    reportSentAt: iso(r.reportSentAt),
    verdicts,
  };
}

import { ApiError, type ClientErrorCode } from '@taskop/api-client';
import { type AuditDetail, type AuditDto, type AuditItemVerdict, type AuditQueueRow, type AuditVerdict, visibleItems } from '@taskop/contracts';
import { executionFixture, occurrenceDto } from '@/features/executions/fixtures';

/** Test data shared by the audit tests. Not imported by application code. */

/** Valid UUIDs: the /audits URL validator checks ids. */
const uuid = (n: number) => `0192f1e2-7c3a-7b4d-8e5f-${n.toString(16).padStart(12, '0')}`;
export const AUDIT_IDS = {
  audit: uuid(0x501),
  audit2: uuid(0x502),
  execution: uuid(0x503),
  occurrence: uuid(0x504),
  site: uuid(0x505),
  checklist: uuid(0x506),
  auditor: uuid(0x507),
  executor: uuid(0x508),
} as const;

export const AUDITOR = { kind: 'user' as const, id: AUDIT_IDS.auditor, name: 'Rəşad Kazımov' };

/** In progress since 14:00 Baku, no verdicts, no report yet. */
export const auditDto = (over: Partial<AuditDto> = {}): AuditDto => ({
  id: AUDIT_IDS.audit,
  executionId: 'x1',
  occurrenceId: 'o1',
  status: 'in_progress',
  paused: false,
  auditor: AUDITOR,
  startedAt: '2026-11-02T10:00:00.000Z',
  finishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  result: null,
  score: null,
  comment: null,
  reportStatus: 'none',
  reportRecipients: [],
  reportSentAt: null,
  verdicts: [],
  ...over,
});

/**
 * The execution fixture under audit: six auditable items, in order "Problem varmı?", "Təsvir edin" (follow-up),
 * "Temperatur", "Ümumi görünüş" (section Zal), "Video", "Qeyd" (section Son). The run waits for audit; the
 * checklist sends its report to rehber@acme.az.
 */
export function auditFixture() {
  const f = executionFixture();
  const auditableItemIds = visibleItems(f.content, f.answers).map((v) => v.item.id);
  const detail = (over: Partial<AuditDetail> = {}): AuditDetail => ({
    ...auditDto(),
    execution: f.detail({ occurrence: occurrenceDto({ status: 'audit_pending' }) }),
    corrections: { original: null, corrections: [], reworkRequests: [], diff: [] },
    auditableItemIds,
    checklistReportEmails: ['rehber@acme.az'],
    requiresAudit: true,
    ...over,
  });
  return { ...f, auditableItemIds, detail };
}

export const verdict = (itemId: string, v: AuditVerdict, comment: string | null = null): AuditItemVerdict => ({
  itemId,
  verdict: v,
  comment,
  updatedBy: { id: 'me1', fullName: 'Leyla Quliyeva' },
  updatedAt: '2026-11-02T10:05:00.000Z',
});

/** A run waiting for audit: completed 09:00 Baku by Nigar at Anbar №1. */
export const queueRow = (over: Partial<AuditQueueRow> = {}): AuditQueueRow => ({
  occurrenceId: AUDIT_IDS.occurrence,
  executionId: AUDIT_IDS.execution,
  auditId: null,
  checklist: { id: AUDIT_IDS.checklist, name: 'Açılış yoxlaması' },
  site: { id: AUDIT_IDS.site, name: 'Anbar №1' },
  executor: { id: AUDIT_IDS.executor, fullName: 'Nigar Səfərli' },
  localDate: '2026-11-02',
  completedAt: '2026-11-02T05:00:00.000Z',
  status: 'audit_pending',
  auditState: 'waiting',
  auditor: null,
  result: null,
  percent: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

/** An API error with the extra body fields Part 1 reads into ApiError (auditId, itemIds, missing, fields). */
export const apiError = (status: number, code: ClientErrorCode, extra: Partial<Pick<ApiError, 'auditId' | 'itemIds' | 'missing' | 'fields'>> = {}): ApiError =>
  Object.assign(new ApiError(status, code, `errors.${code}`), extra);

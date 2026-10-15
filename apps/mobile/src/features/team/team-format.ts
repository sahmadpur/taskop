import { CANCEL_REASON_CODES, type LocalDate, type OccurrenceStatus, type ReportRun } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import type { TFunction } from 'i18next';

/** A server receipt is shown under a device time only when they differ by more than this (decision 11, as on the web). */
export const RECEIPT_TOLERANCE_MS = 60_000;

export const receiptDiffers = (deviceAt: string, receivedAt: string | null): boolean =>
  receivedAt !== null && Math.abs(Date.parse(receivedAt) - Date.parse(deviceAt)) > RECEIPT_TOLERANCE_MS;

/** "70%", "66,7%"; "—" when there is nothing to divide (spec §3.1, §8 "Empty period"). */
export function percentText(t: TFunction, value: number | null): string {
  if (value === null) return t('reports.noValue');
  return t('executions.percent', { value: new Intl.NumberFormat(intlLocale('az'), { maximumFractionDigits: 1 }).format(value) });
}

export type StatusTone = 'neutral' | 'warning' | 'danger' | 'success';

/** The colour of a run's status badge. */
export function statusTone(status: OccurrenceStatus): StatusTone {
  switch (status) {
    case 'completed':
    case 'audit_pending':
    case 'audited':
      return 'success';
    case 'overdue':
    case 'missed':
      return 'danger';
    case 'partial':
    case 'correction_required':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Who a run row names, as spec §3.3 attributes it: the executor; else every assignee; else "Təyin edilməyib". */
export function runPerson(t: TFunction, run: Pick<ReportRun, 'executor' | 'assignees'>): string {
  if (run.executor) return run.executor.fullName;
  if (run.assignees.length > 0) return run.assignees.map((a) => a.fullName).join(', ');
  return t('reports.employees.unassigned');
}

/** 2026-11-02 → 02.11.2026. */
export function formatLocalDay(day: LocalDate): string {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

/** A system cancel reason in words (decision 15); a manager's own reason as typed. */
export function cancelReasonText(t: TFunction, reason: string): string {
  return (CANCEL_REASON_CODES as readonly string[]).includes(reason) ? t(`scheduling.cancelReasons.${reason}`) : reason;
}

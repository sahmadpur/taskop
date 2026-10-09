import {
  addDays,
  type Answer,
  dayNumber,
  EXECUTION_LIMITS,
  type ExecutionState,
  type Item,
  localDateSchema,
  type ProblemSeverity,
} from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import type { TFunction } from 'i18next';
import { optionLabel } from '@/features/checklists/labels';
import { formatLocalDate, type Variant } from '@/features/scheduling/labels';

/** Spec §8: the server receipt is shown under a device time only when they differ by more than a minute. */
export const RECEIPT_TOLERANCE_MS = 60_000;

export const receiptDiffers = (deviceAt: string, receivedAt: string | null): boolean =>
  receivedAt !== null && Math.abs(Date.parse(receivedAt) - Date.parse(deviceAt)) > RECEIPT_TOLERANCE_MS;

export const formatPercent = (value: number, locale = 'az'): string =>
  new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(value);

export const executionStateVariant = (s: ExecutionState): Variant =>
  s === 'completed' ? 'default' : s === 'active' ? 'secondary' : s === 'partial' ? 'destructive' : 'outline';

export const severityVariant = (s: ProblemSeverity): Variant => (s === 'critical' ? 'destructive' : 'secondary');

/**
 * The value of one answer as text. Media, notes and problems are shown beside it, so photo and video
 * items have no text value. Null = nothing answered.
 */
export function answerValue(t: TFunction, item: Item, a: Answer | undefined, formatDateTime: (iso: string) => string): string | null {
  if (!a) return null;
  if ('options' in item) {
    const picked = item.options
      .map((o, i) => (a.optionIds?.includes(o.id) ? optionLabel(t, item, o, i) : null))
      .filter((s): s is string => s !== null);
    return picked.length ? picked.join(', ') : null;
  }
  switch (item.type) {
    case 'number':
      return typeof a.number === 'number' ? (item.unit ? `${a.number} ${item.unit}` : String(a.number)) : null;
    case 'text':
    case 'comment':
      return a.text?.trim() || null;
    case 'datetime':
      if (!a.datetime) return null;
      return item.mode === 'date' ? formatLocalDate(a.datetime) : item.mode === 'time' ? a.datetime : formatDateTime(a.datetime);
    default:
      return null;
  }
}

/** Mirrors the API's range check (≤ 92 days, spec §6.8) so an impossible range is never sent. Null = valid. */
export function problemRangeError(from: string, to: string): string | null {
  if (!localDateSchema.safeParse(from).success || !localDateSchema.safeParse(to).success) return 'errors.validation.required';
  const days = dayNumber(to) - dayNumber(from) + 1;
  if (days < 1) return 'executions.problemsPage.rangeInverted';
  if (days > EXECUTION_LIMITS.problemsMaxDays) return 'executions.issues.rangeTooLong';
  return null;
}

/** The last 7 days of the tenant's calendar, today included. `today` must be the tenant-local date. */
export const defaultProblemRange = (today: string): { from: string; to: string } => ({ from: addDays(today, -6), to: today });

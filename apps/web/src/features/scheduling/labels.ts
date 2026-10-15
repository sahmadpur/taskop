import {
  type AssignmentStatus,
  CANCEL_REASON_CODES,
  describeSchedule,
  localDateOf,
  type OccurrenceStatus,
  type Recurrence,
  type Timing,
} from '@taskop/contracts';
import { formatLocalDate as formatLocalDateIn, formatTime } from '@taskop/i18n';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/lib/session';
import { useLocale } from '@/lib/i18n';

/** Badge variants: default = done/positive, secondary = in progress, warning = late/partial/rework, destructive = missed/failed, audit = audit, outline = neutral. */
export type Variant = 'default' | 'secondary' | 'warning' | 'destructive' | 'audit' | 'outline';

export const occurrenceVariant = (s: OccurrenceStatus): Variant =>
  s === 'missed'
    ? 'destructive'
    : s === 'overdue' || s === 'partial' || s === 'correction_required'
      ? 'warning'
      : s === 'cancelled'
        ? 'outline'
        : s === 'pending'
          ? 'outline'
          : s === 'started' || s === 'in_progress'
            ? 'secondary'
            : s === 'audit_pending'
              ? 'audit'
              : 'default';

export const assignmentVariant = (s: AssignmentStatus): Variant => (s === 'active' ? 'default' : s === 'paused' ? 'secondary' : 'outline');

export const scheduleSummary = (t: TFunction, r: Recurrence, timing: Timing, shiftName: string | null): string =>
  describeSchedule(r, timing, shiftName, (key, vars) => t(key, vars));

/** System reasons are codes (spec §5.3); a manager's own reason is free text. */
export const cancelReasonText = (t: TFunction, reason: string | null): string | null =>
  reason !== null && (CANCEL_REASON_CODES as readonly string[]).includes(reason) ? t(`scheduling.cancelReasons.${reason}`) : reason;

/** 'YYYY-MM-DD' as a short date with the weekday, in the UI language; never shifted by a time zone. */
export function formatLocalDate(date: string, locale = 'az'): string {
  return formatLocalDateIn(date, locale, { weekday: true });
}

export function useTimeFormat(): (iso: string) => string {
  const { tenant } = useMe();
  const locale = useLocale();
  return useCallback((iso: string) => formatTime(iso, { locale, timeZone: tenant.timezone }), [locale, tenant.timezone]);
}

export function useTenantToday(): string {
  const { tenant } = useMe();
  return localDateOf(new Date(), tenant.timezone);
}

export function useDebounced<T>(value: T, ms = 400): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return current;
}

import {
  type AssignmentStatus,
  CANCEL_REASON_CODES,
  describeSchedule,
  localDateOf,
  type OccurrenceStatus,
  type Recurrence,
  type Timing,
} from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/lib/session';

export type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

export const occurrenceVariant = (s: OccurrenceStatus): Variant =>
  s === 'overdue' || s === 'missed' || s === 'partial'
    ? 'destructive'
    : s === 'cancelled'
      ? 'outline'
      : s === 'pending' || s === 'started' || s === 'in_progress'
        ? 'secondary'
        : 'default';

export const assignmentVariant = (s: AssignmentStatus): Variant => (s === 'active' ? 'default' : s === 'paused' ? 'secondary' : 'outline');

export const scheduleSummary = (t: TFunction, r: Recurrence, timing: Timing, shiftName: string | null): string =>
  describeSchedule(r, timing, shiftName, (key, vars) => t(key, vars));

/** System reasons are codes (spec §5.3); a manager's own reason is free text. */
export const cancelReasonText = (t: TFunction, reason: string | null): string | null =>
  reason !== null && (CANCEL_REASON_CODES as readonly string[]).includes(reason) ? t(`scheduling.cancelReasons.${reason}`) : reason;

/** 'YYYY-MM-DD' as a short date with weekday; formatted in UTC so it never moves a day. */
export function formatLocalDate(date: string, locale = 'az'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function useTimeFormat(): (iso: string) => string {
  const { tenant } = useMe();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(intlLocale(tenant.locale), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tenant.timezone }).format(new Date(iso)),
    [tenant.locale, tenant.timezone],
  );
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

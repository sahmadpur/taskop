import type { Recurrence, Timing } from './scheduling.js';
import { minutesToTime, timeToMinutes } from './scheduling-time.js';

/** The caller's translate function, so contracts stays free of UI strings. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const weekdayList = (days: number[], t: Translate): string =>
  [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) => t(`scheduling.weekdaysShort.${d}`))
    .join(', ');

function describeDays(r: Recurrence, t: Translate): string {
  switch (r.kind) {
    case 'once':
      return t('scheduling.summary.once', { date: r.date });
    case 'dates':
      return t('scheduling.summary.dates', { count: r.dates.length });
    case 'daily':
      return r.every === 1 ? t('scheduling.summary.daily') : t('scheduling.summary.everyNDays', { n: r.every });
    case 'weekly':
      return r.every === 1
        ? t('scheduling.summary.weekly', { days: weekdayList(r.weekdays, t) })
        : t('scheduling.summary.everyNWeeks', { n: r.every, days: weekdayList(r.weekdays, t) });
    case 'monthly': {
      const day =
        'dayOfMonth' in r.by
          ? t('scheduling.summary.dayOfMonth', { day: r.by.dayOfMonth })
          : t('scheduling.summary.nthWeekday', {
              nth: t(`scheduling.nth.${r.by.nth === -1 ? 'last' : r.by.nth}`),
              weekday: t(`scheduling.weekdays.${r.by.weekday}`),
            });
      return r.every === 1 ? t('scheduling.summary.monthly', { day }) : t('scheduling.summary.everyNMonths', { n: r.every, day });
    }
  }
}

function describeTime(timing: Timing, shiftName: string | null, t: Translate): string {
  if (timing.mode === 'shift') return t('scheduling.summary.shift', { shift: shiftName ?? '—' });
  const end = timeToMinutes(timing.startTime) + timing.dueAfterMinutes;
  const range = `${timing.startTime}–${minutesToTime(end)}`;
  const days = Math.floor(end / 1440);
  return days === 0 ? range : t('scheduling.summary.plusDays', { range, days });
}

/** A one-line human summary, e.g. "Hər həftə: B.e., Ç., 08:00–10:00". */
export function describeSchedule(r: Recurrence, timing: Timing, shiftName: string | null, t: Translate): string {
  return `${describeDays(r, t)}, ${describeTime(timing, shiftName, t)}`;
}

import { describe, expect, it } from 'vitest';
import { describeSchedule, type Translate } from './scheduling-describe.js';

/** Echoes the key and its variables, so the test pins exactly which strings are asked for. */
const t: Translate = (key, vars) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(';')})` : key);
const fixed = (startTime: string, dueAfterMinutes: number) => ({ mode: 'fixed' as const, startTime, dueAfterMinutes, graceMinutes: 0 });
const r0 = { startDate: '2026-11-02', endDate: null, skipDates: [] };

describe('describeSchedule', () => {
  it('describes daily and weekly rules with a time range', () => {
    expect(describeSchedule({ kind: 'daily', every: 1, ...r0 }, fixed('08:00', 120), null, t)).toBe('scheduling.summary.daily, 08:00–10:00');
    expect(describeSchedule({ kind: 'daily', every: 2, ...r0 }, fixed('08:00', 60), null, t)).toBe('scheduling.summary.everyNDays(n=2), 08:00–09:00');
    expect(describeSchedule({ kind: 'weekly', every: 1, weekdays: [3, 1], ...r0 }, fixed('08:00', 120), null, t)).toBe(
      'scheduling.summary.weekly(days=scheduling.weekdaysShort.1, scheduling.weekdaysShort.3), 08:00–10:00',
    );
    expect(describeSchedule({ kind: 'weekly', every: 2, weekdays: [5], ...r0 }, fixed('08:00', 60), null, t)).toBe(
      'scheduling.summary.everyNWeeks(n=2;days=scheduling.weekdaysShort.5), 08:00–09:00',
    );
  });

  it('describes monthly rules', () => {
    expect(describeSchedule({ kind: 'monthly', every: 1, by: { dayOfMonth: 15 }, ...r0 }, fixed('09:00', 60), null, t)).toBe(
      'scheduling.summary.monthly(day=scheduling.summary.dayOfMonth(day=15)), 09:00–10:00',
    );
    expect(describeSchedule({ kind: 'monthly', every: 3, by: { nth: -1, weekday: 5 }, ...r0 }, fixed('09:00', 60), null, t)).toBe(
      'scheduling.summary.everyNMonths(n=3;day=scheduling.summary.nthWeekday(nth=scheduling.nth.last;weekday=scheduling.weekdays.5)), 09:00–10:00',
    );
  });

  it('describes one-off dates, overnight windows and shifts', () => {
    expect(describeSchedule({ kind: 'once', date: '2026-11-05' }, fixed('22:00', 240), null, t)).toBe(
      'scheduling.summary.once(date=2026-11-05), scheduling.summary.plusDays(range=22:00–02:00;days=1)',
    );
    expect(describeSchedule({ kind: 'dates', dates: ['2026-11-05', '2026-11-06'] }, { mode: 'shift', shiftId: 'x', graceMinutes: 0 }, 'Səhər', t)).toBe(
      'scheduling.summary.dates(count=2), scheduling.summary.shift(shift=Səhər)',
    );
  });
});

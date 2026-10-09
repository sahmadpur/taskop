import { describe, expect, it } from 'vitest';
import {
  expandSchedule,
  type Recurrence,
  recurrenceSchema,
  scheduleDates,
  scheduleWarnings,
  slotFor,
  timingSchema,
  validateSchedule,
  windowMinutes,
} from './scheduling.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const range = (startDate: string, extra: Partial<{ endDate: string | null; skipDates: string[] }> = {}) => ({
  startDate,
  endDate: null,
  skipDates: [],
  ...extra,
});

describe('recurrence schema', () => {
  it('accepts each kind', () => {
    const ok: Recurrence[] = [
      { kind: 'once', date: '2026-11-05' },
      { kind: 'daily', every: 1, ...range('2026-11-02') },
      { kind: 'weekly', every: 1, weekdays: [1, 3], ...range('2026-11-02') },
      { kind: 'monthly', every: 1, by: { dayOfMonth: 31 }, ...range('2026-11-02') },
      { kind: 'monthly', every: 1, by: { nth: -1, weekday: 5 }, ...range('2026-11-02') },
      { kind: 'dates', dates: ['2026-11-05'] },
    ];
    for (const r of ok) expect(recurrenceSchema.safeParse(r).success, r.kind).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(recurrenceSchema.safeParse({ kind: 'daily', every: 0, ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'weekly', every: 1, weekdays: [], ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'weekly', every: 1, weekdays: [8], ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'monthly', every: 1, by: { nth: 5, weekday: 1 }, ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'dates', dates: [] }).success).toBe(false);
    expect(timingSchema.safeParse({ mode: 'fixed', startTime: '8:00', dueAfterMinutes: 60, graceMinutes: 0 }).success).toBe(false);
    expect(timingSchema.safeParse({ mode: 'fixed', startTime: '08:00', dueAfterMinutes: 0, graceMinutes: 0 }).success).toBe(false);
  });
});

describe('scheduleDates', () => {
  it('handles once and explicit dates', () => {
    expect(scheduleDates({ kind: 'once', date: '2026-11-05' }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-05']);
    expect(scheduleDates({ kind: 'once', date: '2026-10-05' }, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(scheduleDates({ kind: 'dates', dates: ['2026-11-09', '2026-11-03', '2026-12-01'] }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-03', '2026-11-09']);
  });

  it('counts daily intervals from startDate', () => {
    expect(scheduleDates({ kind: 'daily', every: 3, ...range('2026-11-02') }, '2026-11-01', '2026-11-12')).toEqual(['2026-11-02', '2026-11-05', '2026-11-08', '2026-11-11']);
  });

  it('honours skip dates and the end date', () => {
    const r: Recurrence = { kind: 'daily', every: 1, ...range('2026-11-02', { endDate: '2026-11-05', skipDates: ['2026-11-03'] }) };
    expect(scheduleDates(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-04', '2026-11-05']);
  });

  it('runs weekly on chosen weekdays every N weeks from the start week', () => {
    // 2026-11-04 is a Wednesday; its ISO week starts on Monday 2026-11-02.
    const r: Recurrence = { kind: 'weekly', every: 2, weekdays: [1, 5], ...range('2026-11-04') };
    expect(scheduleDates(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-06', '2026-11-16', '2026-11-20', '2026-11-30']);
  });

  it('clamps a monthly day of month to short months', () => {
    const r: Recurrence = { kind: 'monthly', every: 1, by: { dayOfMonth: 31 }, ...range('2026-01-01') };
    expect(scheduleDates(r, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('runs monthly every N months from the start month', () => {
    const r: Recurrence = { kind: 'monthly', every: 2, by: { dayOfMonth: 15 }, ...range('2026-01-10') };
    expect(scheduleDates(r, '2026-01-01', '2026-06-30')).toEqual(['2026-01-15', '2026-03-15', '2026-05-15']);
  });

  it('finds the nth and the last weekday of a month', () => {
    const second: Recurrence = { kind: 'monthly', every: 1, by: { nth: 2, weekday: 2 }, ...range('2026-11-01') };
    expect(scheduleDates(second, '2026-11-01', '2026-12-31')).toEqual(['2026-11-10', '2026-12-08']);
    const last: Recurrence = { kind: 'monthly', every: 1, by: { nth: -1, weekday: 5 }, ...range('2026-11-01') };
    expect(scheduleDates(last, '2026-11-01', '2026-12-31')).toEqual(['2026-11-27', '2026-12-25']);
  });
});

describe('slots', () => {
  it('builds fixed slots in the tenant timezone', () => {
    const s = slotFor('2026-11-02', { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 }, null, 'Asia/Baku');
    expect([s.startsAt, s.dueAt, s.closesAt].map((x) => x.toISOString())).toEqual([
      '2026-11-02T04:00:00.000Z',
      '2026-11-02T06:00:00.000Z',
      '2026-11-02T07:00:00.000Z',
    ]);
  });

  it('lets a shift cross midnight', () => {
    const s = slotFor('2026-11-02', { mode: 'shift', shiftId: ID, graceMinutes: 30 }, { startTime: '22:00', endTime: '06:00' }, 'Asia/Baku');
    expect(s.localDate).toBe('2026-11-02');
    expect(s.startsAt.toISOString()).toBe('2026-11-02T18:00:00.000Z');
    expect(s.dueAt.toISOString()).toBe('2026-11-03T02:00:00.000Z');
    expect(s.closesAt.toISOString()).toBe('2026-11-03T02:30:00.000Z');
  });

  it('keeps the wall-clock start across a DST change', () => {
    const timing = { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 60, graceMinutes: 0 } as const;
    const slots = expandSchedule({ kind: 'daily', every: 1, ...range('2026-10-24') }, timing, null, 'Europe/Berlin', '2026-10-24', '2026-10-26');
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-10-24T06:00:00.000Z', '2026-10-25T07:00:00.000Z', '2026-10-26T07:00:00.000Z']);
  });

  it('measures windows', () => {
    expect(windowMinutes({ mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 }, null)).toBe(180);
    expect(windowMinutes({ mode: 'shift', shiftId: ID, graceMinutes: 30 }, { startTime: '22:00', endTime: '06:00' })).toBe(510);
  });
});

describe('validateSchedule and warnings', () => {
  it('reports cross-field issues with paths relative to the schedule', () => {
    expect(validateSchedule({ kind: 'daily', every: 1, ...range('2026-11-10', { endDate: '2026-11-01' }) })).toEqual([
      { path: ['endDate'], code: 'scheduling.issues.endBeforeStart' },
    ]);
    expect(validateSchedule({ kind: 'weekly', every: 1, weekdays: [1, 1], ...range('2026-11-02') })).toEqual([
      { path: ['weekdays'], code: 'scheduling.issues.duplicateWeekday' },
    ]);
    expect(validateSchedule({ kind: 'dates', dates: ['2026-11-05', '2026-11-06', '2026-11-05'] })).toEqual([
      { path: ['dates', 2], code: 'scheduling.issues.duplicateDate' },
    ]);
    expect(validateSchedule({ kind: 'once', date: '2026-11-05' })).toEqual([]);
  });

  it('warns about skip dates outside the range', () => {
    expect(scheduleWarnings({ kind: 'daily', every: 1, ...range('2026-11-02', { skipDates: ['2026-10-01'] }) })).toEqual(['SKIP_DATE_OUT_OF_RANGE']);
    expect(scheduleWarnings({ kind: 'daily', every: 1, ...range('2026-11-02', { skipDates: ['2026-11-03'] }) })).toEqual([]);
  });
});

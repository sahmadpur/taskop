import { z } from 'zod';
import type { ContentIssue } from './checklist-content.js';
import { idSchema } from './common.js';
import {
  addDays,
  dayNumber,
  daysInMonth,
  fromDayNumber,
  isoWeekday,
  type LocalDate,
  localDateSchema,
  type LocalTime,
  localTimeSchema,
  timeToMinutes,
  zonedTimeToUtc,
} from './scheduling-time.js';

export const SCHEDULING_LIMITS = {
  /** FR-09.05: start → close without `assignments.extended_window`. */
  maxWindowMinutes: 24 * 60,
  /** Hard cap, even with `assignments.extended_window` (FR-09.06). */
  maxExtendedWindowMinutes: 7 * 24 * 60,
  horizonDays: 14,
  maxAssignees: 50,
  rosterMaxDays: 62,
  copyMaxWeeks: 12,
  previewSlots: 20,
  /** A schedule with no slot this many days ahead is rejected as empty. */
  emptyCheckDays: 366,
  maxListDays: 62,
} as const;

export const isoWeekdaySchema = z.number().int().min(1).max(7);

const range = {
  startDate: localDateSchema,
  endDate: localDateSchema.nullable(),
  skipDates: z.array(localDateSchema).max(366),
};

export const recurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date: localDateSchema }),
  z.object({ kind: z.literal('daily'), every: z.number().int().min(1).max(365), ...range }),
  z.object({ kind: z.literal('weekly'), every: z.number().int().min(1).max(52), weekdays: z.array(isoWeekdaySchema).min(1).max(7), ...range }),
  z.object({
    kind: z.literal('monthly'),
    every: z.number().int().min(1).max(12),
    by: z.union([
      z.object({ dayOfMonth: z.number().int().min(1).max(31) }),
      z.object({ nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]), weekday: isoWeekdaySchema }),
    ]),
    ...range,
  }),
  z.object({ kind: z.literal('dates'), dates: z.array(localDateSchema).min(1).max(366) }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type RecurrenceKind = Recurrence['kind'];
export const RECURRENCE_KINDS = ['once', 'daily', 'weekly', 'monthly', 'dates'] as const satisfies readonly RecurrenceKind[];

const graceMinutes = z.number().int().min(0).max(SCHEDULING_LIMITS.maxExtendedWindowMinutes);
export const timingSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fixed'),
    startTime: localTimeSchema,
    dueAfterMinutes: z.number().int().min(1).max(SCHEDULING_LIMITS.maxExtendedWindowMinutes),
    graceMinutes,
  }),
  z.object({ mode: z.literal('shift'), shiftId: idSchema, graceMinutes }),
]);
export type Timing = z.infer<typeof timingSchema>;

export interface ShiftHours {
  startTime: LocalTime;
  endTime: LocalTime;
}

export interface Slot {
  localDate: LocalDate;
  startsAt: Date;
  dueAt: Date;
  closesAt: Date;
}

/** An end time at or before the start time means the shift ends the next day. */
export function shiftDurationMinutes(s: ShiftHours): number {
  const d = timeToMinutes(s.endTime) - timeToMinutes(s.startTime);
  return d > 0 ? d : d + 1440;
}

/** Start → close length of every slot (FR-09.05). */
export function windowMinutes(timing: Timing, shift: ShiftHours | null): number {
  if (timing.mode === 'fixed') return timing.dueAfterMinutes + timing.graceMinutes;
  if (!shift) throw new Error('shift timing needs the shift hours');
  return shiftDurationMinutes(shift) + timing.graceMinutes;
}

type RangeRecurrence = Exclude<Recurrence, { kind: 'once' | 'dates' }>;

function matches(r: RangeRecurrence, d: LocalDate): boolean {
  const dn = dayNumber(d);
  const start = dayNumber(r.startDate);
  switch (r.kind) {
    case 'daily':
      return (dn - start) % r.every === 0;
    case 'weekly': {
      const weekStart = start - (isoWeekday(r.startDate) - 1);
      return r.weekdays.includes(isoWeekday(d)) && Math.floor((dn - weekStart) / 7) % r.every === 0;
    }
    case 'monthly': {
      const [y, m, day] = d.split('-').map(Number) as [number, number, number];
      const [sy, sm] = r.startDate.split('-').map(Number) as [number, number];
      if (((y - sy) * 12 + (m - sm)) % r.every !== 0) return false;
      const len = daysInMonth(y, m);
      if ('dayOfMonth' in r.by) return day === Math.min(r.by.dayOfMonth, len);
      if (isoWeekday(d) !== r.by.weekday) return false;
      return r.by.nth === -1 ? day + 7 > len : Math.ceil(day / 7) === r.by.nth;
    }
  }
}

/** Local dates the rule fires on within [from, to] (inclusive), in order. */
export function scheduleDates(r: Recurrence, from: LocalDate, to: LocalDate): LocalDate[] {
  if (r.kind === 'once' || r.kind === 'dates') {
    const list = r.kind === 'once' ? [r.date] : r.dates;
    return [...new Set(list)].filter((d) => d >= from && d <= to).sort();
  }
  const skip = new Set(r.skipDates);
  const first = Math.max(dayNumber(from), dayNumber(r.startDate));
  const last = Math.min(dayNumber(to), r.endDate ? dayNumber(r.endDate) : Number.POSITIVE_INFINITY);
  const out: LocalDate[] = [];
  for (let n = first; n <= last; n++) {
    const d = fromDayNumber(n);
    if (!skip.has(d) && matches(r, d)) out.push(d);
  }
  return out;
}

export function slotFor(date: LocalDate, timing: Timing, shift: ShiftHours | null, tz: string): Slot {
  if (timing.mode === 'fixed') {
    const startsAt = zonedTimeToUtc(date, timeToMinutes(timing.startTime), tz);
    const dueAt = new Date(+startsAt + timing.dueAfterMinutes * 60_000);
    return { localDate: date, startsAt, dueAt, closesAt: new Date(+dueAt + timing.graceMinutes * 60_000) };
  }
  if (!shift) throw new Error('shift timing needs the shift hours');
  const startsAt = zonedTimeToUtc(date, timeToMinutes(shift.startTime), tz);
  const overnight = timeToMinutes(shift.endTime) <= timeToMinutes(shift.startTime);
  const dueAt = zonedTimeToUtc(overnight ? addDays(date, 1) : date, timeToMinutes(shift.endTime), tz);
  return { localDate: date, startsAt, dueAt, closesAt: new Date(+dueAt + timing.graceMinutes * 60_000) };
}

export function expandSchedule(r: Recurrence, timing: Timing, shift: ShiftHours | null, tz: string, from: LocalDate, to: LocalDate): Slot[] {
  return scheduleDates(r, from, to).map((d) => slotFor(d, timing, shift, tz));
}

export const SCHEDULING_ISSUE_CODES = [
  'scheduling.issues.endBeforeStart',
  'scheduling.issues.duplicateDate',
  'scheduling.issues.duplicateWeekday',
  'scheduling.issues.shiftZeroLength',
  'scheduling.issues.rangeTooLong',
  'scheduling.issues.dateOutOfRange',
] as const;
export type SchedulingIssueCode = (typeof SCHEDULING_ISSUE_CODES)[number];

/** Cross-field checks the Zod schema cannot express. Paths are relative to the schedule. */
export function validateSchedule(r: Recurrence): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (r.kind === 'once') return issues;
  if (r.kind === 'dates') {
    const seen = new Set<string>();
    r.dates.forEach((d, i) => {
      if (seen.has(d)) issues.push({ path: ['dates', i], code: 'scheduling.issues.duplicateDate' });
      seen.add(d);
    });
    return issues;
  }
  if (r.endDate && r.endDate < r.startDate) issues.push({ path: ['endDate'], code: 'scheduling.issues.endBeforeStart' });
  if (r.kind === 'weekly' && new Set(r.weekdays).size !== r.weekdays.length) {
    issues.push({ path: ['weekdays'], code: 'scheduling.issues.duplicateWeekday' });
  }
  return issues;
}

export const PREVIEW_WARNINGS = ['NO_ROSTERED_ASSIGNEES', 'SKIP_DATE_OUT_OF_RANGE'] as const;
export type PreviewWarning = (typeof PREVIEW_WARNINGS)[number];

/** Warnings that depend only on the rule; the API adds the roster-based one. */
export function scheduleWarnings(r: Recurrence): PreviewWarning[] {
  if (r.kind === 'once' || r.kind === 'dates') return [];
  const outside = r.skipDates.some((d) => d < r.startDate || (r.endDate !== null && d > r.endDate));
  return outside ? ['SKIP_DATE_OUT_OF_RANGE'] : [];
}

/** `superRefine` for `{ from, to }` queries: 1 ≤ days ≤ maxDays, reported on `to`. */
export const localRangeCheck =
  (maxDays: number) =>
  (v: { from: LocalDate; to: LocalDate }, ctx: z.RefinementCtx): void => {
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > maxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'scheduling.issues.rangeTooLong' });
  };

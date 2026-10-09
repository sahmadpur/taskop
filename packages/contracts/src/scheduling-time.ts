import { z } from 'zod';

/** A calendar date in the tenant's timezone, 'YYYY-MM-DD'. */
export type LocalDate = string;
/** A wall-clock time, 'HH:mm' (24h). */
export type LocalTime = string;

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayNumber(d: LocalDate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / DAY_MS);
}

export function fromDayNumber(n: number): LocalDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (d: LocalDate, days: number): LocalDate => fromDayNumber(dayNumber(d) + days);

/** ISO weekday: 1 = Monday … 7 = Sunday. Day 0 (1970-01-01) was a Thursday. */
export const isoWeekday = (d: LocalDate): number => ((((dayNumber(d) + 3) % 7) + 7) % 7) + 1;

/** `month` is 1–12. */
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function timeToMinutes(t: LocalTime): number {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Wraps at midnight: 1500 → '01:00'. */
export function minutesToTime(min: number): LocalTime {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// The regex guard must run first: Zod 4 still runs refines after a failed format check, and
// dayNumber/fromDayNumber throw RangeError on non-date input.
export const localDateSchema = z
  .string()
  .refine((d) => DATE_RE.test(d) && fromDayNumber(dayNumber(d)) === d, { error: 'errors.validation.invalid' });
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'errors.validation.invalid' });

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock reading in `tz` at instant `ms`, written as if it were a UTC timestamp. */
function wallMs(tz: string, ms: number): number {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** UTC offset of `tz` at `instant`, in minutes (Asia/Baku → 240). */
export function tzOffsetMinutes(tz: string, instant: Date | number): number {
  const ms = Math.floor(+instant / 1000) * 1000;
  return Math.round((wallMs(tz, ms) - ms) / 60_000);
}

export function localDateOf(instant: Date, tz: string): LocalDate {
  return new Date(wallMs(tz, Math.floor(+instant / 1000) * 1000)).toISOString().slice(0, 10);
}

/**
 * The instant at which the wall clock in `tz` shows `date` + `minutes`.
 * Ambiguous times (fall back) take the earlier instant. Times inside a spring-forward gap are read
 * with the offset in force before the gap, so 02:30 becomes 03:30 (as RFC 5545 does).
 */
export function zonedTimeToUtc(date: LocalDate, minutes: number, tz: string): Date {
  const wall = dayNumber(date) * DAY_MS + minutes * 60_000;
  const before = tzOffsetMinutes(tz, wall - DAY_MS);
  const after = tzOffsetMinutes(tz, wall + DAY_MS);
  const valid = [wall - before * 60_000, wall - after * 60_000]
    .filter((c) => wallMs(tz, c) === wall)
    .sort((a, b) => a - b);
  return new Date(valid[0] ?? wall - before * 60_000);
}

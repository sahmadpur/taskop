import type { DateTimeMode } from '@taskop/contracts';

const pad = (n: number) => String(n).padStart(2, '0');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2}) (([01]\d|2[0-3]):[0-5]\d)$/;

const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A real calendar date: 2026-02-30 does not survive the round trip. */
function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00`);
  return !Number.isNaN(d.getTime()) && formatLocal(d).slice(0, 10) === s;
}

/** What the worker typed → the stored answer, in the formats `answerIssues` accepts; null when invalid. */
export function toAnswerDatetime(mode: DateTimeMode, text: string): string | null {
  const s = text.trim();
  if (mode === 'date') return isDate(s) ? s : null;
  if (mode === 'time') return TIME.test(s) ? s : null;
  const m = DATETIME.exec(s);
  if (!m || !isDate(m[1]!)) return null;
  // Device local time → a UTC instant.
  return new Date(`${m[1]}T${m[2]}`).toISOString();
}

/** The stored answer → what the field shows (date-times in device local time). */
export function fromAnswerDatetime(mode: DateTimeMode, value: string | undefined): string {
  if (!value) return '';
  return mode === 'datetime' ? formatLocal(new Date(value)) : value;
}

/** "İndi": the current device time in the field's format. */
export function nowInputFor(mode: DateTimeMode, ms: number): string {
  const s = formatLocal(new Date(ms));
  return mode === 'date' ? s.slice(0, 10) : mode === 'time' ? s.slice(11) : s;
}

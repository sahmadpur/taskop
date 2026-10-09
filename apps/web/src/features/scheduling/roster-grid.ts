import { addDays, isoWeekday, type RosterRow } from '@taskop/contracts';

export const weekStartOf = (date: string): string => addDays(date, 1 - isoWeekday(date));
export const weekDates = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));
export const rowKey = (r: RosterRow): string => `${r.userId}|${r.shiftId}|${r.date}`;

export function parseKey(key: string): RosterRow {
  const [userId, shiftId, date] = key.split('|') as [string, string, string];
  return { userId, shiftId, date };
}

export function toggleKey(set: ReadonlySet<string>, key: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

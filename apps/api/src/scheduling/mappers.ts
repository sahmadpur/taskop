import type { ShiftDto } from '@taskop/contracts';

/** Postgres `time` reads back as 'HH:MM:SS'. */
export const hhmm = (t: string): string => t.slice(0, 5);

export interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  siteId: string | null;
  siteName: string | null;
  active: boolean;
}

export const toShiftDto = (r: ShiftRow): ShiftDto => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) });

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
};

/** Deep equality for JSON values; jsonb does not keep key order. */
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

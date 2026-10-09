import { type AssignmentDto, type OccurrenceDto, type OccurrenceHistoryEntry, type Recurrence, recurrenceSchema, type ShiftDto, timingSchema, type UserRef } from '@taskop/contracts';
import type { assignments, occurrences, occurrenceStatusHistory } from '../db/schema';

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

/** Sorts the order-free lists of a schedule, so re-ordering them is not a change. */
export function normaliseSchedule(r: Recurrence): Recurrence {
  const sorted = <T>(xs: T[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  switch (r.kind) {
    case 'once':
      return r;
    case 'dates':
      return { ...r, dates: sorted(r.dates) };
    case 'weekly':
      return { ...r, weekdays: sorted(r.weekdays), skipDates: sorted(r.skipDates) };
    default:
      return { ...r, skipDates: sorted(r.skipDates) };
  }
}

/** Deep equality for JSON values; jsonb does not keep key order. */
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export interface OccurrenceJoinedRow {
  o: typeof occurrences.$inferSelect;
  assignmentName: string | null;
  checklistName: string;
  siteName: string;
  shiftName: string | null;
  assigneeIds: string[];
}

export const toOccurrenceDto = (r: OccurrenceJoinedRow): OccurrenceDto => ({
  id: r.o.id,
  assignmentId: r.o.assignmentId,
  assignmentName: r.assignmentName,
  checklistId: r.o.checklistId,
  checklistName: r.checklistName,
  siteId: r.o.siteId,
  siteName: r.siteName,
  shiftId: r.o.shiftId,
  shiftName: r.shiftName,
  localDate: r.o.localDate,
  startsAt: r.o.startsAt.toISOString(),
  dueAt: r.o.dueAt.toISOString(),
  closesAt: r.o.closesAt.toISOString(),
  status: r.o.status,
  statusChangedAt: r.o.statusChangedAt.toISOString(),
  cancelReason: r.o.cancelReason,
  assigneeIds: r.assigneeIds,
  unassigned: (r.o.status === 'pending' || r.o.status === 'overdue') && r.assigneeIds.length === 0,
});

export interface AssignmentJoinedRow {
  a: typeof assignments.$inferSelect;
  checklistName: string;
  siteName: string;
  shiftName: string | null;
  assignees: UserRef[];
}

export const toAssignmentDto = (r: AssignmentJoinedRow): AssignmentDto => ({
  id: r.a.id,
  name: r.a.name,
  checklistId: r.a.checklistId,
  checklistName: r.checklistName,
  siteId: r.a.siteId,
  siteName: r.siteName,
  schedule: recurrenceSchema.parse(r.a.schedule),
  timing: timingSchema.parse(r.a.timing),
  shiftName: r.shiftName,
  status: r.a.status,
  revision: r.a.revision,
  assignees: r.assignees,
  createdAt: r.a.createdAt.toISOString(),
  updatedAt: r.a.updatedAt.toISOString(),
});

export const toHistoryEntry = (r: { h: typeof occurrenceStatusHistory.$inferSelect; actorName: string | null }): OccurrenceHistoryEntry => ({
  fromStatus: r.h.fromStatus,
  toStatus: r.h.toStatus,
  at: r.h.at.toISOString(),
  actor: r.h.actorUserId
    ? { kind: 'user', name: r.actorName }
    : r.h.actorPlatformAdminId
      ? { kind: 'platform', name: null }
      : { kind: 'system', name: null },
  reason: r.h.reason,
});

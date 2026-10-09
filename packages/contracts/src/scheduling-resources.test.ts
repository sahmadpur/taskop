import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  copyRosterInputSchema,
  createAssignmentInputSchema,
  createShiftInputSchema,
  ERROR_HTTP_STATUS,
  errorBodySchema,
  OCCURRENCE_STATUSES,
  occurrenceListQuerySchema,
  putRosterInputSchema,
  SYSTEM_ROLE_DEFAULTS,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const schedule = { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] };
const timing = { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 };

describe('scheduling resources', () => {
  it('rejects a zero-length shift on endTime', () => {
    const r = createShiftInputSchema.safeParse({ name: 'Səhər', startTime: '08:00', endTime: '08:00' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['endTime'], message: 'scheduling.issues.shiftZeroLength' });
    expect(createShiftInputSchema.safeParse({ name: 'Gecə', startTime: '22:00', endTime: '06:00' }).success).toBe(true);
  });

  it('parses comma-separated statuses and limits the date range', () => {
    const ok = occurrenceListQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', status: 'pending,overdue' });
    expect(ok.status).toEqual(['pending', 'overdue']);
    expect(ok.limit).toBe(50);
    expect(occurrenceListQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30', status: 'pending,bogus' }).success).toBe(false);
    const long = occurrenceListQuerySchema.safeParse({ from: '2026-11-01', to: '2027-01-02' });
    expect(long.success).toBe(false);
    expect(long.error!.issues[0]).toMatchObject({ path: ['to'], message: 'scheduling.issues.rangeTooLong' });
  });

  it('keeps roster rows inside the range and copies whole weeks', () => {
    const r = putRosterInputSchema.safeParse({ siteId: ID, from: '2026-11-02', to: '2026-11-08', rows: [{ userId: ID, shiftId: ID, date: '2026-11-09' }] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['rows', 0, 'date'], message: 'scheduling.issues.dateOutOfRange' });
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-09'] }).success).toBe(true);
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-05'] }).success).toBe(false);
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-02'] }).success).toBe(false);
    // Only later weeks: copying must not overwrite past weeks.
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-09', targetWeekStarts: ['2026-11-02'] }).success).toBe(false);
  });

  it('requires 1–50 assignees', () => {
    const base = { checklistId: ID, siteId: ID, schedule, timing };
    expect(createAssignmentInputSchema.safeParse({ ...base, assigneeIds: [] }).success).toBe(false);
    expect(createAssignmentInputSchema.safeParse({ ...base, assigneeIds: Array(51).fill(ID) }).success).toBe(false);
    expect(createAssignmentInputSchema.safeParse({ ...base, assigneeIds: [ID] }).success).toBe(true);
  });

  it('defines the full FR-11.01 status list', () => {
    expect(OCCURRENCE_STATUSES).toEqual(['pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited']);
  });

  it('registers error codes, the userIds detail and permissions', () => {
    expect(ERROR_HTTP_STATUS.SITE_OUT_OF_SCOPE).toBe(403);
    expect(ERROR_HTTP_STATUS.REVISION_CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.ASSIGNEE_NOT_AT_SITE).toBe(422);
    const body = { error: { code: 'ASSIGNEE_NOT_AT_SITE', messageKey: 'errors.ASSIGNEE_NOT_AT_SITE', fields: null, retryAfterSeconds: null, requestId: null, userIds: [ID] } };
    expect(errorBodySchema.parse(body).error.userIds).toEqual([ID]);
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['assignments.view', 'assignments.manage', 'assignments.extended_window', 'shifts.view', 'shifts.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toEqual(expect.arrayContaining(['assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('assignments.extended_window');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toEqual(expect.arrayContaining(['assignments.view', 'shifts.view']));
  });
});

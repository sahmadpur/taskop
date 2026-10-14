import { describe, expect, it } from 'vitest';
import {
  employeeReportRowSchema,
  ERROR_HTTP_STATUS,
  errorBodySchema,
  PERMISSION_GROUPS,
  REPORT_AUDIT_ACTIONS,
  SYSTEM_ROLE_DEFAULTS,
  REPORT_CONTENT_TYPES,
  REPORT_EXPORT_KINDS,
  REPORT_FORMATS,
  REPORT_ISSUE_CODES,
  REPORT_KINDS,
  reportExportQuerySchema,
  reportFileName,
  reportFiltersSchema,
  reportProblemsQuerySchema,
  reportProblemsSchema,
  reportRunPageSchema,
  reportRunsQuerySchema,
  reportSummarySchema,
  reportTaskCountsSchema,
  reportTasksQuerySchema,
  reportTasksSchema,
  RUN_BUCKETS,
  RUN_COUNT_KEYS,
  runCountsSchema,
  siteReportRowSchema,
  TASK_STATUSES,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const AT = '2026-11-02T06:00:00.000Z';
const range = { from: '2026-11-02', to: '2026-11-04' };
const zero = Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, 0]));

describe('report catalogue', () => {
  it('lists the kinds, export kinds, formats, buckets and issue codes', () => {
    expect(REPORT_KINDS).toEqual(['summary', 'sites', 'employees', 'runs', 'problems', 'tasks']);
    expect(REPORT_EXPORT_KINDS).toEqual([...REPORT_KINDS, 'full']);
    expect(REPORT_FORMATS).toEqual(['csv', 'xlsx', 'pdf']);
    expect(RUN_BUCKETS).toEqual(['overdue', 'partial', 'missed', 'problems', 'completed', 'in_progress', 'planned', 'all']);
    expect(REPORT_ISSUE_CODES).toEqual(['reports.issues.toBeforeFrom', 'reports.issues.fullNotCsv']);
  });

  it('names files taskop-<kind>-<from>_<to>.<ext> and types them', () => {
    expect(reportFileName('runs', '2026-11-01', '2026-11-30', 'csv')).toBe('taskop-runs-2026-11-01_2026-11-30.csv');
    expect(reportFileName('full', '2026-11-01', '2026-11-30', 'xlsx')).toBe('taskop-full-2026-11-01_2026-11-30.xlsx');
    expect(REPORT_CONTENT_TYPES).toEqual({
      csv: 'text/csv; charset=utf-8',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    });
  });
});

describe('report queries', () => {
  it('parses the shared filters and refuses a range that ends before it starts', () => {
    expect(reportFiltersSchema.parse({ ...range, siteId: ID, userId: ID, checklistId: ID })).toEqual({ ...range, siteId: ID, userId: ID, checklistId: ID });
    const inverted = reportFiltersSchema.safeParse({ from: '2026-11-04', to: '2026-11-02' });
    expect(inverted.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['to', 'reports.issues.toBeforeFrom']]);
    expect(reportFiltersSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(reportFiltersSchema.safeParse({ from: '2026-11-02' }).success).toBe(false);
    expect(reportFiltersSchema.safeParse({ ...range, siteId: 'nope' }).success).toBe(false);
  });

  it('leaves the range length to the API (REPORT_RANGE_TOO_LONG)', () => {
    expect(reportFiltersSchema.safeParse({ from: '2026-01-01', to: '2027-06-01' }).success).toBe(true);
  });

  it('defaults the runs bucket to all and takes a cursor', () => {
    expect(reportRunsQuerySchema.parse(range)).toEqual({ ...range, bucket: 'all' });
    expect(reportRunsQuerySchema.parse({ ...range, bucket: 'missed', cursor: ID })).toEqual({ ...range, bucket: 'missed', cursor: ID });
    expect(reportRunsQuerySchema.safeParse({ ...range, bucket: 'late' }).success).toBe(false);
    expect(reportRunsQuerySchema.safeParse({ from: '2026-11-04', to: '2026-11-02' }).success).toBe(false);
  });

  it('filters problems by severity and pages tasks', () => {
    expect(reportProblemsQuerySchema.parse({ ...range, severity: 'critical' })).toEqual({ ...range, severity: 'critical' });
    expect(reportProblemsQuerySchema.safeParse({ ...range, severity: 'major' }).success).toBe(false);
    expect(reportTasksQuerySchema.parse({ ...range, cursor: ID })).toEqual({ ...range, cursor: ID });
  });

  it('needs a known format to export', () => {
    expect(reportExportQuerySchema.parse({ ...range, format: 'pdf', bucket: 'overdue' })).toEqual({ ...range, format: 'pdf', bucket: 'overdue' });
    expect(reportExportQuerySchema.safeParse(range).success).toBe(false);
    expect(reportExportQuerySchema.safeParse({ ...range, format: 'docx' }).success).toBe(false);
  });
});

describe('report responses', () => {
  it('has one count per RUN_COUNT_KEYS entry, in that order', () => {
    expect(Object.keys(runCountsSchema.shape)).toEqual([...RUN_COUNT_KEYS]);
  });

  it('parses a summary with a zero day in its trend', () => {
    const s = { counts: zero, completionPercent: null, averageScore: null, trend: [{ date: '2026-11-02', due: 0, completed: 0, completionPercent: null }] };
    expect(reportSummarySchema.parse(s)).toEqual(s);
    expect(reportSummarySchema.safeParse({ ...s, counts: { ...zero, planned: -1 } }).success).toBe(false);
  });

  it('parses site and employee rows, including the Unassigned row', () => {
    const site = { ...zero, planned: 1, siteId: ID, name: 'Zona A1', path: ['Filial A'], active: true, completionPercent: null, averageScore: null };
    expect(siteReportRowSchema.parse(site)).toEqual(site);
    const unassigned = { ...zero, planned: 1, due: 1, missed: 1, userId: null, name: 'Təyin edilməyib', active: true, completionPercent: 0, averageScore: null };
    expect(employeeReportRowSchema.parse(unassigned)).toEqual(unassigned);
  });

  it('parses a run row with the device and the server completion times', () => {
    const row = {
      occurrenceId: ID, executionId: ID, localDate: '2026-11-02', dueAt: AT,
      checklist: { id: ID, name: 'Açılış yoxlaması' }, site: { id: ID, name: 'Zona A1' }, status: 'completed',
      assignees: [{ id: ID, fullName: 'Aynur Quliyeva' }], executor: { id: ID, fullName: 'Aynur Quliyeva' },
      startedAt: AT, completedAt: AT, completedReceivedAt: '2026-11-04T05:00:00.000Z',
      score: 90, problemCount: 1, criticalCount: 0, late: true, clockSuspect: false,
    };
    expect(reportRunPageSchema.parse({ items: [row], nextCursor: null }).items[0]).toEqual(row);
  });

  it('parses problems and tasks with their counts', () => {
    const problems = { counts: { total: 0, critical: 0, resolution: { none: 0, open: 0, resolved: 0, cancelled: 0 } }, items: [], nextCursor: null };
    expect(reportProblemsSchema.parse(problems)).toEqual(problems);
    expect(Object.keys(reportTaskCountsSchema.shape.byStatus.shape)).toEqual([...TASK_STATUSES]);
    const tasks = {
      counts: { byStatus: Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])), overdueOpen: 0, completedOnTime: 0, completedLate: 0 },
      items: [{ id: ID, title: 'Qapını təmir et', priority: 'high', status: 'completed', site: null, assignee: null, team: { id: ID, name: 'Texniki xidmət' }, dueAt: null, completedAt: AT, createdAt: AT, overdue: false, problemId: null }],
      nextCursor: ID,
    };
    expect(reportTasksSchema.parse(tasks)).toEqual(tasks);
  });
});

describe('report errors, permissions and audit', () => {
  it('adds the three report error codes with their statuses and the row cap details', () => {
    expect([ERROR_HTTP_STATUS.REPORT_RANGE_TOO_LONG, ERROR_HTTP_STATUS.REPORT_TOO_LARGE, ERROR_HTTP_STATUS.REPORT_TIMEOUT]).toEqual([400, 422, 503]);
    const body = errorBodySchema.parse({
      error: { code: 'REPORT_TOO_LARGE', messageKey: 'errors.REPORT_TOO_LARGE', fields: null, retryAfterSeconds: null, requestId: 'r1', rows: 12000, limit: 10000 },
    });
    expect(body.error).toMatchObject({ rows: 12000, limit: 10000 });
  });

  it('adds the reports permissions last, for Manager and Auditor by default', () => {
    expect(PERMISSION_GROUPS.at(-1)).toEqual({ group: 'reports', keys: ['reports.view', 'reports.export'] });
    for (const role of ['owner', 'admin', 'manager', 'auditor'] as const) {
      expect(SYSTEM_ROLE_DEFAULTS[role].permissions, role).toEqual(expect.arrayContaining(['reports.view', 'reports.export']));
    }
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
  });

  it('lists the audited report action', () => {
    expect(REPORT_AUDIT_ACTIONS).toEqual(['reports.exported']);
  });
});

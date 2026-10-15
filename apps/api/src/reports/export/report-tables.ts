import {
  type EmployeeReportRow,
  type ReportProblem,
  type ReportRun,
  type ReportSummary,
  type ReportTask,
  RUN_COUNT_KEYS,
  type RunBucket,
  type RunCounts,
  type SiteReportRow,
} from '@taskop/contracts';
import { az } from '@taskop/i18n';
import type { CellValue, ReportColumn, ReportTable } from './report-table';

const L = az.reports;
const C = L.columns;

const COUNT_COLUMNS: ReportColumn[] = RUN_COUNT_KEYS.map((k) => ({ label: L.counts[k], type: 'int' }));
const countCells = (c: RunCounts): CellValue[] => RUN_COUNT_KEYS.map((k) => c[k]);
const measureColumns: ReportColumn[] = [
  { label: L.measures.completionPercent, type: 'decimal' },
  { label: L.measures.averageScore, type: 'decimal' },
];

/** The summary export: the measures, then the daily trend (Spec decision 17). */
export function summaryTables(s: ReportSummary): ReportTable[] {
  return [
    {
      title: L.sheets.summary,
      columns: [{ label: C.measure, type: 'text', width: 24 }, { label: C.value, type: 'number' }],
      rows: [...RUN_COUNT_KEYS.map((k): CellValue[] => [L.counts[k], s.counts[k]]), [L.measures.completionPercent, s.completionPercent], [L.measures.averageScore, s.averageScore]],
    },
    {
      title: L.sheets.trend,
      columns: [{ label: C.date, type: 'date' }, { label: L.counts.due, type: 'int' }, { label: L.counts.completed, type: 'int' }, { label: L.measures.completionPercent, type: 'decimal' }],
      rows: s.trend.map((d) => [d.date, d.due, d.completed, d.completionPercent]),
    },
  ];
}

export function sitesTable(rows: SiteReportRow[]): ReportTable {
  return {
    title: L.sheets.sites,
    columns: [{ label: C.site, type: 'text', width: 24 }, { label: C.path, type: 'text', width: 30 }, { label: C.active, type: 'bool' }, ...COUNT_COLUMNS, ...measureColumns],
    rows: rows.map((r) => [r.name, r.path.join(' › '), r.active, ...countCells(r), r.completionPercent, r.averageScore]),
  };
}

export function employeesTable(rows: EmployeeReportRow[]): ReportTable {
  return {
    title: L.sheets.employees,
    columns: [{ label: C.employee, type: 'text', width: 24 }, { label: C.active, type: 'bool' }, ...COUNT_COLUMNS, ...measureColumns],
    rows: rows.map((r) => [r.name, r.active, ...countCells(r), r.completionPercent, r.averageScore]),
  };
}

/** "İcralar", or "İcralar (Buraxılmış)" for one bucket. */
export const runsTitle = (bucket: RunBucket): string => (bucket === 'all' ? L.sheets.runs : `${L.sheets.runs} (${L.buckets[bucket]})`);

/** Device start and completion beside the server receipt (FR-10.14), with the late and clock-suspect flags (spec §8). */
export function runsTable(rows: ReportRun[], title: string): ReportTable {
  return {
    title,
    columns: [
      { label: C.date, type: 'date' },
      { label: C.dueAt, type: 'datetime' },
      { label: C.checklist, type: 'text', width: 24 },
      { label: C.site, type: 'text', width: 20 },
      { label: C.status, type: 'text' },
      { label: C.assignees, type: 'text', width: 30 },
      { label: C.executor, type: 'text', width: 20 },
      { label: C.startedAt, type: 'datetime' },
      { label: C.completedAt, type: 'datetime' },
      { label: C.completedReceivedAt, type: 'datetime' },
      { label: C.score, type: 'decimal' },
      { label: C.problemCount, type: 'int' },
      { label: C.criticalCount, type: 'int' },
      { label: C.late, type: 'bool' },
      { label: C.clockSuspect, type: 'bool' },
      // SP8 spec §8.3.
      { label: az.audits.audit, type: 'text', width: 16 },
      { label: az.corrections.corrected, type: 'bool' },
    ],
    rows: rows.map((r) => [
      r.localDate,
      r.dueAt,
      r.checklist.name,
      r.site.name,
      az.scheduling.statuses[r.status],
      r.assignees.map((a) => a.fullName).join(', '),
      r.executor?.fullName ?? null,
      r.startedAt,
      r.completedAt,
      r.completedReceivedAt,
      r.score,
      r.problemCount,
      r.criticalCount,
      r.late,
      r.clockSuspect,
      r.auditState ? az.audits.runAuditStates[r.auditState] : null,
      r.corrected,
    ]),
  };
}

export function problemsTable(rows: ReportProblem[]): ReportTable {
  return {
    title: L.sheets.problems,
    columns: [
      { label: C.date, type: 'date' },
      { label: C.site, type: 'text', width: 20 },
      { label: C.checklist, type: 'text', width: 24 },
      { label: C.item, type: 'text', width: 30 },
      { label: C.severity, type: 'text' },
      { label: C.source, type: 'text' },
      { label: C.note, type: 'text', width: 40 },
      { label: C.executor, type: 'text', width: 20 },
      { label: C.recordedAt, type: 'datetime' },
      { label: C.resolution, type: 'text' },
      { label: C.taskStatus, type: 'text' },
    ],
    rows: rows.map((p) => [
      p.localDate,
      p.siteName,
      p.checklistName,
      p.itemLabel,
      az.executions.severities[p.severity],
      az.executions.problemSources[p.source],
      p.note,
      p.executorName,
      p.createdAt,
      az.tasks.resolutions[p.resolution],
      p.taskStatus ? az.tasks.statuses[p.taskStatus] : null,
    ]),
  };
}

export function tasksTable(rows: ReportTask[]): ReportTable {
  return {
    title: L.sheets.tasks,
    columns: [
      { label: C.title, type: 'text', width: 30 },
      { label: C.site, type: 'text', width: 20 },
      { label: C.assignee, type: 'text', width: 24 },
      { label: C.status, type: 'text' },
      { label: C.priority, type: 'text' },
      { label: C.due, type: 'datetime' },
      { label: C.completed, type: 'datetime' },
      { label: C.overdue, type: 'bool' },
    ],
    rows: rows.map((x) => [
      x.title,
      x.site?.name ?? null,
      x.assignee?.fullName ?? x.team?.name ?? null,
      az.tasks.statuses[x.status],
      az.tasks.priorities[x.priority],
      x.dueAt,
      x.completedAt,
      x.overdue,
    ]),
  };
}

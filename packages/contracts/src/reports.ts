import { z } from 'zod';
import { idSchema, isoDateTimeSchema, pageOf } from './common.js';
import { problemSeveritySchema } from './execution-logic.js';
import { problemDtoSchema } from './execution-views.js';
import { occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, localDateSchema } from './scheduling-time.js';
import { taskPrioritySchema, taskStatusSchema } from './tasks.js';

/** Sub-project 7 spec §5.3: the six report tables. */
export const REPORT_KINDS = ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks'] as const;
export const reportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof reportKindSchema>;

/** Spec §5.4: every table can be exported, and so can the full period report. */
export const REPORT_EXPORT_KINDS = [...REPORT_KINDS, 'full'] as const;
export const reportExportKindSchema = z.enum(REPORT_EXPORT_KINDS);
export type ReportExportKind = z.infer<typeof reportExportKindSchema>;

export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** /reports/runs lists. `planned` = every run not cancelled; `problems` = with problems, not cancelled; `all` includes cancelled runs (Spec decision 6). */
export const RUN_BUCKETS = ['overdue', 'partial', 'missed', 'problems', 'completed', 'in_progress', 'planned', 'all'] as const;
export const runBucketSchema = z.enum(RUN_BUCKETS);
export type RunBucket = z.infer<typeof runBucketSchema>;

/** Field keys of report validation errors; also i18n keys. */
export const REPORT_ISSUE_CODES = ['reports.issues.toBeforeFrom', 'reports.issues.fullNotCsv'] as const;
export type ReportIssueCode = (typeof REPORT_ISSUE_CODES)[number];

/** Spec §5.2. The range length (to − from ≤ 365) is checked by the API: it answers REPORT_RANGE_TOO_LONG. */
const filterShape = {
  from: localDateSchema,
  to: localDateSchema,
  siteId: idSchema.optional(),
  userId: idSchema.optional(),
  checklistId: idSchema.optional(),
};
const toNotBeforeFrom = (v: { from: string; to: string }, ctx: z.RefinementCtx): void => {
  if (dayNumber(v.to) < dayNumber(v.from)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'reports.issues.toBeforeFrom' });
};

export const reportFiltersSchema = z.object(filterShape).superRefine(toNotBeforeFrom);
export type ReportFiltersQuery = z.input<typeof reportFiltersSchema>;
export type ReportFilters = z.output<typeof reportFiltersSchema>;

export const reportRunsQuerySchema = z
  .object({ ...filterShape, bucket: runBucketSchema.default('all'), cursor: idSchema.optional() })
  .superRefine(toNotBeforeFrom);
export type ReportRunsQuery = z.input<typeof reportRunsQuerySchema>;
export type ReportRunsParams = z.output<typeof reportRunsQuerySchema>;

/** `severity` feeds the dashboard's critical-problems panel (Spec decision 5). */
export const reportProblemsQuerySchema = z
  .object({ ...filterShape, severity: problemSeveritySchema.optional(), cursor: idSchema.optional() })
  .superRefine(toNotBeforeFrom);
export type ReportProblemsQuery = z.input<typeof reportProblemsQuerySchema>;
export type ReportProblemsParams = z.output<typeof reportProblemsQuerySchema>;

export const reportTasksQuerySchema = z.object({ ...filterShape, cursor: idSchema.optional() }).superRefine(toNotBeforeFrom);
export type ReportTasksQuery = z.input<typeof reportTasksQuerySchema>;
export type ReportTasksParams = z.output<typeof reportTasksQuerySchema>;

/** `bucket` applies to the runs export (default all), `severity` to the problems export; the full report ignores both. */
export const reportExportQuerySchema = z
  .object({ ...filterShape, format: reportFormatSchema, bucket: runBucketSchema.optional(), severity: problemSeveritySchema.optional() })
  .superRefine(toNotBeforeFrom);
export type ReportExportQuery = z.input<typeof reportExportQuerySchema>;
export type ReportExportParams = z.output<typeof reportExportQuerySchema>;

const count = z.number().int().min(0);
const percent = z.number().nullable();
const refSchema = z.object({ id: idSchema, name: z.string() });

/** One number per RUN_COUNT_KEYS entry, in that order (report-logic.ts). */
export const runCountsSchema = z.object({
  planned: count,
  due: count,
  completed: count,
  inProgress: count,
  pending: count,
  overdue: count,
  partial: count,
  missed: count,
  withProblems: count,
  withCritical: count,
});

export const reportTrendDaySchema = z.object({ date: localDateSchema, due: count, completed: count, completionPercent: percent });
export type ReportTrendDay = z.infer<typeof reportTrendDaySchema>;

/** GET /reports/summary. The trend has one entry per day of the range, zero days included. */
export const reportSummarySchema = z.object({ counts: runCountsSchema, completionPercent: percent, averageScore: percent, trend: z.array(reportTrendDaySchema) });
export type ReportSummary = z.infer<typeof reportSummarySchema>;

/** GET /reports/sites: sites with at least one planned run, in tree order. `path` = ancestor names, root first. */
export const siteReportRowSchema = runCountsSchema.extend({
  siteId: idSchema,
  name: z.string(),
  path: z.array(z.string()),
  active: z.boolean(),
  completionPercent: percent,
  averageScore: percent,
});
export type SiteReportRow = z.infer<typeof siteReportRowSchema>;

/** GET /reports/employees (spec §3.3). `userId: null` is the Unassigned row, last. */
export const employeeReportRowSchema = runCountsSchema.extend({
  userId: idSchema.nullable(),
  name: z.string(),
  active: z.boolean(),
  completionPercent: percent,
  averageScore: percent,
});
export type EmployeeReportRow = z.infer<typeof employeeReportRowSchema>;

/** A row of GET /reports/runs. Device times (startedAt, completedAt) beside the server receipt (FR-10.14). */
export const reportRunSchema = z.object({
  occurrenceId: idSchema,
  /** The counted execution; null when the run was never started. */
  executionId: idSchema.nullable(),
  localDate: localDateSchema,
  dueAt: isoDateTimeSchema,
  checklist: refSchema,
  site: refSchema,
  status: occurrenceStatusSchema,
  /** The assignee snapshot, by name. */
  assignees: z.array(userRefSchema),
  executor: userRefSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  completedReceivedAt: isoDateTimeSchema.nullable(),
  score: z.number().nullable(),
  problemCount: count,
  criticalCount: count,
  late: z.boolean(),
  clockSuspect: z.boolean(),
});
export type ReportRun = z.infer<typeof reportRunSchema>;
export const reportRunPageSchema = pageOf(reportRunSchema);

/** The /problems row with its linked task's status. */
export const reportProblemSchema = problemDtoSchema.extend({ taskStatus: taskStatusSchema.nullable() });
export type ReportProblem = z.infer<typeof reportProblemSchema>;

export const reportProblemCountsSchema = z.object({
  total: count,
  critical: count,
  resolution: z.object({ none: count, open: count, resolved: count, cancelled: count }),
});
export type ReportProblemCounts = z.infer<typeof reportProblemCountsSchema>;

/** GET /reports/problems: counts over the whole filtered set, then one page of rows. */
export const reportProblemsSchema = z.object({ counts: reportProblemCountsSchema, items: z.array(reportProblemSchema), nextCursor: idSchema.nullable() });
export type ReportProblems = z.infer<typeof reportProblemsSchema>;

export const reportTaskSchema = z.object({
  id: idSchema,
  title: z.string(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  site: refSchema.nullable(),
  assignee: userRefSchema.nullable(),
  team: refSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  /** The sweep marked it overdue; stays after completion (Spec decision 11). */
  overdue: z.boolean(),
  problemId: idSchema.nullable(),
});
export type ReportTask = z.infer<typeof reportTaskSchema>;

/** Spec §3.4. `byStatus` keys in TASK_STATUSES order. */
export const reportTaskCountsSchema = z.object({
  byStatus: z.object({ new: count, accepted: count, in_progress: count, awaiting_review: count, completed: count, cancelled: count }),
  overdueOpen: count,
  completedOnTime: count,
  completedLate: count,
});
export type ReportTaskCounts = z.infer<typeof reportTaskCountsSchema>;

export const reportTasksSchema = z.object({ counts: reportTaskCountsSchema, items: z.array(reportTaskSchema), nextCursor: idSchema.nullable() });
export type ReportTasks = z.infer<typeof reportTasksSchema>;

export const REPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** The download's name (spec §5.4): `taskop-<kind>-<from>_<to>.<ext>`. */
export const reportFileName = (kind: ReportExportKind, from: string, to: string, format: ReportFormat): string => `taskop-${kind}-${from}_${to}.${format}`;

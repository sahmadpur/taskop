import {
  type ChecklistSummary,
  type EmployeeReportRow,
  emptyRunCounts,
  type ReportProblem,
  type ReportProblems,
  type ReportRun,
  type ReportSummary,
  type ReportTask,
  type ReportTasks,
  type RunCounts,
  type SiteDto,
  type SiteReportRow,
} from '@taskop/contracts';
import { problemDto } from '@/features/tasks/fixtures';

/** Test data shared by the report tests. Not imported by application code. */

/** A Wednesday. */
export const TODAY = '2026-11-04';
/** Valid UUIDv7s: the URL validator checks ids. */
const uuid = (n: number) => `0192f1e2-7c3a-7b4d-8e5f-${n.toString(16).padStart(12, '0')}`;
export const IDS = {
  branch: uuid(0xb1),
  zoneA: uuid(0xb2),
  zoneB: uuid(0xb3),
  aynur: uuid(0xc1),
  kamran: uuid(0xc2),
  rauf: uuid(0xc3),
  stranger: uuid(0xc9),
  checklist: uuid(0xd1),
  oldChecklist: uuid(0xd2),
  run: uuid(0xe1),
  run2: uuid(0xe2),
  execution: uuid(0xe9),
  problem: uuid(0xa1),
  task: uuid(0xf1),
  task2: uuid(0xf2),
} as const;

const AYNUR = { id: IDS.aynur, fullName: 'Aynur Quliyeva' };
const KAMRAN = { id: IDS.kamran, fullName: 'Kamran Əliyev' };

export const counts = (over: Partial<RunCounts> = {}): RunCounts => ({ ...emptyRunCounts(), ...over });

/** 12 planned, 10 due (7 completed, 1 in progress, 1 overdue, 1 partial), 2 pending; three days of trend. */
export const reportSummary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  counts: counts({ planned: 12, due: 10, completed: 7, inProgress: 1, pending: 2, overdue: 1, partial: 1, withProblems: 2, withCritical: 1 }),
  completionPercent: 70,
  averageScore: 87.5,
  trend: [
    { date: '2026-11-02', due: 4, completed: 3, completionPercent: 75 },
    { date: '2026-11-03', due: 0, completed: 0, completionPercent: null },
    { date: TODAY, due: 6, completed: 4, completionPercent: 66.7 },
  ],
  ...over,
});

export const siteRow = (over: Partial<SiteReportRow> = {}): SiteReportRow => ({
  ...counts({ planned: 8, due: 6, completed: 5, overdue: 1 }),
  siteId: IDS.zoneA,
  name: 'Zona A1',
  path: ['Filial A'],
  active: true,
  completionPercent: 83.3,
  averageScore: 90,
  ...over,
});

/** In tree order: the branch, its active zone, its deactivated zone (no due runs, so no percentages). */
export const SITE_ROWS: SiteReportRow[] = [
  siteRow({ siteId: IDS.branch, name: 'Filial A', path: [], planned: 4, due: 4, completed: 2, overdue: 0, missed: 2, completionPercent: 50, averageScore: 70 }),
  siteRow(),
  siteRow({ siteId: IDS.zoneB, name: 'Zona B (köhnə)', active: false, planned: 1, due: 0, completed: 0, overdue: 0, pending: 1, completionPercent: null, averageScore: null }),
];

export const employeeRow = (over: Partial<EmployeeReportRow> = {}): EmployeeReportRow => ({
  ...counts({ planned: 5, due: 5, completed: 4, missed: 1 }),
  userId: IDS.aynur,
  name: 'Aynur Quliyeva',
  active: true,
  completionPercent: 80,
  averageScore: 91,
  ...over,
});

/** By name, a deactivated person among them, the Unassigned row last (Part 1 decision 9). */
export const EMPLOYEE_ROWS: EmployeeReportRow[] = [
  employeeRow(),
  employeeRow({ userId: IDS.kamran, name: 'Kamran Əliyev', planned: 3, due: 3, completed: 1, missed: 2, completionPercent: 33.3, averageScore: 75 }),
  employeeRow({ userId: IDS.rauf, name: 'Rauf Həsənov', active: false, planned: 1, due: 1, completed: 1, missed: 0, completionPercent: 100, averageScore: 60 }),
  employeeRow({ userId: null, name: 'Təyin edilməyib', planned: 9, due: 9, completed: 0, missed: 9, completionPercent: 0, averageScore: null }),
];

/** Overdue, never started, two assignees; due 10:00 in Baku. */
export const reportRun = (over: Partial<ReportRun> = {}): ReportRun => ({
  occurrenceId: IDS.run,
  executionId: null,
  localDate: TODAY,
  dueAt: '2026-11-04T06:00:00.000Z',
  checklist: { id: IDS.checklist, name: 'Açılış yoxlaması' },
  site: { id: IDS.zoneA, name: 'Zona A1' },
  status: 'overdue',
  assignees: [AYNUR, KAMRAN],
  executor: null,
  startedAt: null,
  completedAt: null,
  completedReceivedAt: null,
  score: null,
  problemCount: 0,
  criticalCount: 0,
  late: false,
  clockSuspect: false,
  auditState: null,
  corrected: false,
  ...over,
});

/** Completed by Aynur offline at 09:40 Baku, received at 13:00; late, clock-suspect, two problems, one critical. */
export const completedRun = (over: Partial<ReportRun> = {}): ReportRun =>
  reportRun({
    occurrenceId: IDS.run2,
    executionId: IDS.execution,
    status: 'completed',
    executor: AYNUR,
    startedAt: '2026-11-04T05:10:00.000Z',
    completedAt: '2026-11-04T05:40:00.000Z',
    completedReceivedAt: '2026-11-04T09:00:00.000Z',
    score: 87.5,
    problemCount: 2,
    criticalCount: 1,
    late: true,
    clockSuspect: true,
    ...over,
  });

/** A critical manual problem of run2 with an open task in progress. */
export const reportProblem = (over: Partial<ReportProblem> = {}): ReportProblem => ({
  ...problemDto({
    id: IDS.problem,
    executionId: IDS.execution,
    occurrenceId: IDS.run2,
    localDate: TODAY,
    siteId: IDS.zoneA,
    siteName: 'Zona A1',
    checklistId: IDS.checklist,
    checklistName: 'Açılış yoxlaması',
    itemLabel: 'Soyuducunun temperaturu',
    note: 'Kondisioner xarabdır',
    executorName: 'Aynur Quliyeva',
    resolution: 'open',
    taskId: IDS.task,
  }),
  taskStatus: 'in_progress',
  ...over,
});

export const reportProblems = (items: ReportProblem[] = [reportProblem()], over: Partial<ReportProblems> = {}): ReportProblems => ({
  counts: { total: 3, critical: 1, resolution: { none: 1, open: 1, resolved: 1, cancelled: 0 } },
  items,
  nextCursor: null,
  ...over,
});

/** High priority, in progress, overdue, due 18:00 Baku, assigned to Kamran. */
export const reportTask = (over: Partial<ReportTask> = {}): ReportTask => ({
  id: IDS.task,
  title: 'Kondisioneri təmir et',
  priority: 'high',
  status: 'in_progress',
  site: { id: IDS.zoneA, name: 'Zona A1' },
  assignee: KAMRAN,
  team: null,
  dueAt: '2026-11-04T14:00:00.000Z',
  completedAt: null,
  createdAt: '2026-11-04T07:00:00.000Z',
  overdue: true,
  problemId: IDS.problem,
  ...over,
});

export const reportTasks = (items: ReportTask[] = [reportTask()], over: Partial<ReportTasks> = {}): ReportTasks => ({
  counts: {
    byStatus: { new: 1, accepted: 0, in_progress: 2, awaiting_review: 1, completed: 3, cancelled: 0 },
    overdueOpen: 1,
    completedOnTime: 2,
    completedLate: 1,
  },
  items,
  nextCursor: null,
  ...over,
});

export const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });

/** A branch with an active and a deactivated zone (GET /sites). */
export const SITES: SiteDto[] = [
  { id: IDS.branch, parentId: null, typeId: 'type1', name: 'Filial A', address: null, active: true, path: 'a', depth: 0 },
  { id: IDS.zoneA, parentId: IDS.branch, typeId: 'type2', name: 'Zona A1', address: null, active: true, path: 'a.b', depth: 1 },
  { id: IDS.zoneB, parentId: IDS.branch, typeId: 'type2', name: 'Zona B (köhnə)', address: null, active: false, path: 'a.c', depth: 1 },
];

const checklist = (over: Partial<ChecklistSummary>): ChecklistSummary => ({
  id: IDS.checklist,
  name: 'Açılış yoxlaması',
  description: null,
  category: null,
  status: 'active',
  currentVersionNumber: 1,
  draftRevision: null,
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...over,
});
export const CHECKLISTS: ChecklistSummary[] = [checklist({}), checklist({ id: IDS.oldChecklist, name: 'Köhnə yoxlama', status: 'deactivated' })];

/** The signed-in user as `useMe()` returns it in the report tests. */
export const meWith = (permissions: readonly string[], tenant: { timezone?: string } = {}) => ({
  user: { id: 'me1', fullName: 'Leyla Quliyeva' },
  role: { id: 'r1', name: 'Manager', systemKey: 'manager', dataScope: 'site_subtree' },
  permissions: [...permissions],
  tenant: { id: 't1', name: 'Acme MMC', orgCode: 'acme', timezone: tenant.timezone ?? 'Asia/Baku', locale: 'az' },
});

/** A report viewer who may also list sites and checklists (as Manager and Auditor may). */
export const VIEWER = ['reports.view', 'sites.view', 'checklists.view'] as const;

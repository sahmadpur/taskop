import {
  type AuditBrief,
  type AuditDetail,
  type AuditItemVerdict,
  type Correction,
  type DataScope,
  type EmployeeReportRow,
  type ExecutionCorrections,
  type ExecutionDetail,
  type ExecutionMediaDto,
  type ExecutionProblem,
  type ExecutionSummary,
  type Me,
  type OccurrenceDetail,
  type Page,
  type PermissionKey,
  type ReportRun,
  type ReportSummary,
  type ReworkRequest,
  RUN_COUNT_KEYS,
  type RunCounts,
} from '@taskop/contracts';
import { type Checklist, CHECKLIST, DEVICE, ME, OCC, SITE, T, TASK, TENANT, VERSION } from '@/offline/testing/fixtures';

export const WORKER_A = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb0';
export const WORKER_B = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb1';
export const ASSIGNMENT = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb2';
export const EXECUTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb3';
export const PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb4';
export const PROBLEM_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb5';
export const PROBLEM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb6';
export const PROBLEM2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb7';
export const RUN_CURSOR = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb8';
/** A second manager signing in on the same phone. */
export const VIEWER2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb9';
export const ROLE = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eba';
export const ITEM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ebb';
/** A photo id an answer holds that the server has not registered yet. */
export const UNREGISTERED_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ebc';

export const AYNUR = { id: WORKER_A, fullName: 'Aynur Quliyeva' };
export const KAMRAN = { id: WORKER_B, fullName: 'Kamran Əliyev' };

/** The executed run of OCC: started 08:10, completed 09:30 in Baku (device), received 13:00 (a late offline sync). */
export const RUN_T = { completed: '2026-11-02T05:30:00.000Z', received: '2026-11-02T09:00:00.000Z' } as const;

/** Leyla, a site_subtree Manager with the report keys: the viewer of the Team tab. */
export function teamMe(o: { id?: string; permissions?: PermissionKey[]; dataScope?: DataScope; timezone?: string } = {}): Me {
  return {
    user: {
      id: o.id ?? ME,
      fullName: 'Leyla Məmmədova',
      jobTitle: 'Menecer',
      kind: 'staff',
      email: 'manager@demo.taskop.az',
      username: null,
      emailVerified: true,
      credentialKind: 'password',
      emailNotifications: true,
    },
    role: { id: ROLE, name: 'Manager', systemKey: 'manager', dataScope: o.dataScope ?? 'site_subtree' },
    permissions: o.permissions ?? ['assignments.view', 'reports.view', 'reports.export'],
    tenant: { id: TENANT, name: 'Demo MMC', orgCode: 'demo', timezone: o.timezone ?? 'Asia/Baku', locale: 'az' },
  };
}

export const counts = (over: Partial<RunCounts> = {}): RunCounts => ({ ...(Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, 0])) as RunCounts), ...over });

/** An empty one-day period. */
export const reportSummary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  counts: counts(),
  completionPercent: null,
  averageScore: null,
  trend: [{ date: '2026-11-02', due: 0, completed: 0, completionPercent: null }],
  ...over,
});

/** Aynur's row: one run, completed. */
export const employeeRow = (over: Partial<EmployeeReportRow> = {}): EmployeeReportRow => ({
  ...counts({ planned: 1, due: 1, completed: 1 }),
  userId: WORKER_A,
  name: AYNUR.fullName,
  active: true,
  completionPercent: 100,
  averageScore: null,
  ...over,
});

/** Spec §3.3: the synthetic row of runs with no execution and no assignee. */
export const unassignedRow = (): EmployeeReportRow =>
  employeeRow({ ...counts({ planned: 1, due: 1, missed: 1 }), userId: null, name: 'Təyin edilməyib', completionPercent: 0 });

/** OCC, assigned to Aynur and Kamran, completed by Aynur, with two problems (one critical). */
export const reportRun = (over: Partial<ReportRun> = {}): ReportRun => ({
  occurrenceId: OCC,
  executionId: EXECUTION,
  localDate: '2026-11-02',
  dueAt: T.due,
  checklist: { id: CHECKLIST, name: 'Açılış yoxlaması' },
  site: { id: SITE, name: 'Bakı filialı 1' },
  status: 'completed',
  assignees: [AYNUR, KAMRAN],
  executor: AYNUR,
  startedAt: T.open,
  completedAt: RUN_T.completed,
  completedReceivedAt: RUN_T.received,
  score: 50,
  problemCount: 2,
  criticalCount: 1,
  late: false,
  clockSuspect: false,
  auditState: null,
  corrected: false,
  ...over,
});

export const runPage = (items: ReportRun[], nextCursor: string | null = null): Page<ReportRun> => ({ items, nextCursor });

/** Aynur's counted execution of OCC: late, clock-suspect, 50 %, completion received hours after the device time. */
export const executionSummary = (over: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
  id: EXECUTION,
  executor: AYNUR,
  state: 'completed',
  rejectedReason: null,
  startedAt: T.open,
  startedReceivedAt: T.open,
  completedAt: RUN_T.completed,
  completedReceivedAt: RUN_T.received,
  late: true,
  clockSuspect: true,
  progress: { answered: 4, total: 5, requiredMissing: 0 },
  scorePercent: 50,
  problemCount: 2,
  mediaPending: 1,
  ...over,
});

/** GET /occurrences/:id of the executed OCC. */
export const occurrenceDetail = (over: Partial<OccurrenceDetail> = {}): OccurrenceDetail => ({
  id: OCC,
  assignmentId: ASSIGNMENT,
  assignmentName: 'Səhər açılışı',
  checklistId: CHECKLIST,
  checklistName: 'Açılış yoxlaması',
  siteId: SITE,
  siteName: 'Bakı filialı 1',
  shiftId: null,
  shiftName: null,
  localDate: '2026-11-02',
  startsAt: T.starts,
  dueAt: T.due,
  closesAt: T.closes,
  status: 'completed',
  statusChangedAt: RUN_T.received,
  cancelReason: null,
  assigneeIds: [WORKER_A, WORKER_B],
  unassigned: false,
  executionBrief: {
    executionId: EXECUTION,
    executorName: AYNUR.fullName,
    state: 'completed',
    progress: { answered: 4, total: 5, requiredMissing: 0 },
    scorePercent: 50,
    late: true,
    clockSuspect: true,
  },
  assignees: [AYNUR, KAMRAN],
  history: [],
  execution: executionSummary(),
  rejectedExecutions: [],
  ...over,
});

/** The same run, missed: nobody started it. */
export const missedOccurrence = (over: Partial<OccurrenceDetail> = {}): OccurrenceDetail =>
  occurrenceDetail({ status: 'missed', executionBrief: null, execution: null, ...over });

export const executionMedia = (id: string, over: Partial<ExecutionMediaDto> = {}): ExecutionMediaDto => ({
  id,
  itemId: null,
  kind: 'photo',
  source: 'camera',
  mime: 'image/jpeg',
  bytes: 1000,
  width: 1600,
  height: 1200,
  durationMs: null,
  capturedAt: T.open,
  capturedBy: AYNUR,
  status: 'uploaded',
  uploadedAt: RUN_T.received,
  ...over,
});

export const executionProblem = (over: Partial<ExecutionProblem> = {}): ExecutionProblem => ({
  id: PROBLEM,
  itemId: ITEM,
  source: 'rule',
  severity: 'critical',
  note: null,
  mediaIds: [],
  createdAt: T.open,
  resolution: 'none',
  taskId: null,
  clearedAt: null,
  ...over,
});

/**
 * GET /executions/:id of Aynur's run over `c` (offline fixtures' `checklist()`):
 * - "Bəli" with an uploaded photo (a critical rule problem) and its follow-up comment;
 * - 10 °C with a note, and a manual problem whose photo is not uploaded yet;
 * - the photo item and the optional note unanswered.
 */
export function executionDetail(c: Checklist, over: Partial<ExecutionDetail> = {}): ExecutionDetail {
  const { assignees: _assignees, history: _history, execution: _execution, rejectedExecutions: _rejected, ...occurrence } = occurrenceDetail();
  return {
    ...executionSummary(),
    occurrence,
    checklistVersionId: VERSION,
    versionNumber: 1,
    content: c.content,
    answers: {
      [c.problem.id]: { optionIds: [c.yes.id], photos: [PHOTO] },
      [c.comment.id]: { text: 'Kompressor səs salır' },
      [c.temp.id]: { number: 10, note: 'Kondisioner xarabdır' },
    },
    answersRev: 3,
    score: { earned: 1, possible: 2, percent: 50, problems: [{ itemId: c.problem.id, severity: 'critical' }, { itemId: c.temp.id, severity: 'normal' }] },
    clockOffsetMs: 0,
    device: DEVICE,
    lastSyncedAt: RUN_T.received,
    media: [executionMedia(PHOTO, { itemId: c.problem.id }), executionMedia(PROBLEM_PHOTO, { itemId: c.temp.id, status: 'pending', uploadedAt: null })],
    problems: [
      executionProblem({ id: PROBLEM, itemId: c.problem.id, severity: 'critical', source: 'rule', mediaIds: [PHOTO] }),
      executionProblem({ id: PROBLEM2, itemId: c.temp.id, severity: 'normal', source: 'manual', note: 'Termometr sınıb', mediaIds: [PROBLEM_PHOTO], resolution: 'open', taskId: TASK }),
    ],
    reworkRound: 0,
    rework: null,
    corrected: false,
    audit: null,
    ...over,
  };
}

export const AUDIT = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed0';
/** An audit another auditor started first (AUDIT_EXISTS). */
export const AUDIT2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed1';
export const CORRECTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed2';
export const CORRECTION2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed3';
export const REQUEST = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed4';
/** The Team viewer (teamMe), as the API names her. */
export const LEYLA = { id: ME, fullName: 'Leyla Məmmədova' };

export const auditBrief = (over: Partial<AuditBrief> = {}): AuditBrief => ({ id: AUDIT, status: 'in_progress', result: null, percent: null, paused: false, ...over });

export const auditVerdict = (itemId: string, over: Partial<AuditItemVerdict> = {}): AuditItemVerdict => ({
  itemId,
  verdict: 'approved',
  comment: null,
  updatedBy: LEYLA,
  updatedAt: RUN_T.received,
  ...over,
});

export const executionCorrections = (over: Partial<ExecutionCorrections> = {}): ExecutionCorrections => ({
  original: null,
  corrections: [],
  reworkRequests: [],
  diff: [],
  ...over,
});

/** Leyla corrected ITEM from 10 to 5. */
export const correction = (over: Partial<Correction> = {}): Correction => ({
  id: CORRECTION,
  itemId: ITEM,
  kind: 'manual',
  round: 0,
  before: { number: 10 },
  after: { number: 5 },
  reason: 'Termometr səhv göstərirdi',
  actor: { kind: 'user', name: LEYLA.fullName },
  at: RUN_T.received,
  ...over,
});

/** Leyla's open send-back of round 1, due 18:00 on 3 Nov in Baku. */
export const teamRework = (over: Partial<ReworkRequest> = {}): ReworkRequest => ({
  id: REQUEST,
  round: 1,
  items: [{ itemId: ITEM, comment: 'Yenidən ölçün' }],
  answersBefore: {},
  dueAt: '2026-11-03T14:00:00.000Z',
  requestedBy: LEYLA,
  requestedAt: RUN_T.received,
  resubmittedAt: null,
  withdrawnAt: null,
  withdrawnBy: null,
  ...over,
});

/**
 * GET /audits/:id of Aynur's run (`executionDetail(c)`), in progress and nothing reviewed. The auditable items are the
 * visible ones in checklist order: the "Bəli" answer shows the follow-up comment.
 */
export function auditDetail(c: Checklist, over: Partial<AuditDetail> = {}): AuditDetail {
  return {
    id: AUDIT,
    executionId: EXECUTION,
    occurrenceId: OCC,
    status: 'in_progress',
    paused: false,
    auditor: { kind: 'user', id: ME, name: LEYLA.fullName },
    startedAt: RUN_T.received,
    finishedAt: null,
    cancelledAt: null,
    cancelReason: null,
    result: null,
    score: null,
    comment: null,
    reportStatus: 'none',
    reportRecipients: [],
    reportSentAt: null,
    verdicts: [],
    execution: executionDetail(c),
    corrections: executionCorrections(),
    auditableItemIds: [c.problem.id, c.comment.id, c.temp.id, c.photo.id, c.note.id],
    checklistReportEmails: ['audit@demo.taskop.az'],
    requiresAudit: false,
    ...over,
  };
}

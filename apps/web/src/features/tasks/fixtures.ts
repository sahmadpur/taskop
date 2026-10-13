import type { ProblemDto, TaskAssigneeOptions, TaskDetail, TaskMediaDto, TaskSubmissionDto, TaskSummary } from '@taskop/contracts';

/** Test data shared by the task tests. Not imported by application code. */
export const AT = '2026-11-02T04:00:00.000Z';
export const MANAGER = { id: 'mgr', fullName: 'Leyla Quliyeva' };
export const WORKER = { id: 'w1', fullName: 'Nigar Səfərli' };
export const TEAM = { id: 'team1', name: 'Texniki xidmət' };

/** A direct task for Nigar at Anbar №1, due 3 November 18:00 Baku. */
export const taskSummary = (over: Partial<TaskSummary> = {}): TaskSummary => ({
  id: 't1',
  title: 'Soyuducunun qapısını təmir edin',
  priority: 'normal',
  status: 'new',
  site: { id: 'site1', name: 'Anbar №1' },
  assignee: WORKER,
  team: null,
  assigneeInactive: false,
  createdBy: MANAGER,
  requiresReview: false,
  source: 'adhoc',
  problemId: null,
  dueAt: '2026-11-03T14:00:00.000Z',
  overdueAt: null,
  rev: 1,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

export const taskDetail = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  ...taskSummary(),
  instructions: '',
  evidence: { photo: 'optional', video: 'optional', liveOnly: false },
  acceptedAt: null,
  startedAt: null,
  submittedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  media: [],
  submissions: [],
  problem: null,
  history: [],
  canManage: true,
  canReview: true,
  ...over,
});

export const taskMediaDto = (over: Partial<TaskMediaDto> & { id: string }): TaskMediaDto => ({
  role: 'response',
  submissionId: null,
  kind: 'photo',
  source: 'camera',
  mime: 'image/jpeg',
  bytes: 1000,
  width: 1600,
  height: 1200,
  durationMs: null,
  capturedAt: AT,
  capturedBy: WORKER,
  status: 'uploaded',
  uploadedAt: AT,
  ...over,
});

export const submissionDto = (over: Partial<TaskSubmissionDto> & { id: string }): TaskSubmissionDto => ({
  submittedBy: WORKER,
  text: '',
  mediaIds: [],
  submittedAt: AT,
  receivedAt: AT,
  reviewDecision: null,
  reviewComment: null,
  reviewedBy: null,
  reviewedAt: null,
  ...over,
});

/** A manual critical problem of a completed run at Anbar №1, without a task. */
export const problemDto = (over: Partial<ProblemDto> = {}): ProblemDto => ({
  id: 'p1',
  executionId: 'x1',
  occurrenceId: 'o1',
  localDate: '2026-11-02',
  siteId: 'site1',
  siteName: 'Anbar №1',
  checklistId: 'c1',
  checklistName: 'Açılış',
  itemId: 'i1',
  itemLabel: 'Temperatur',
  source: 'manual',
  severity: 'critical',
  note: 'Kondisioner xarabdır',
  mediaIds: [],
  media: [],
  executorName: 'Aysel',
  createdAt: AT,
  resolution: 'none',
  taskId: null,
  executionState: 'completed',
  ...over,
});

export const assigneeOptions = (over: Partial<TaskAssigneeOptions> = {}): TaskAssigneeOptions => ({
  users: [
    { id: 'w1', fullName: 'Nigar Səfərli', jobTitle: 'Texnik', kind: 'worker' },
    { id: 'w2', fullName: 'Murad Əliyev', jobTitle: null, kind: 'worker' },
  ],
  teams: [{ id: 'team1', name: 'Texniki xidmət', memberCount: 3 }],
  sites: [{ id: 'site1', name: 'Anbar №1' }],
  ...over,
});

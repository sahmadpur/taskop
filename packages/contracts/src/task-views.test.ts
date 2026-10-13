import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ERROR_HTTP_STATUS,
  problemDtoSchema,
  problemListQuerySchema,
  SYSTEM_ROLE_DEFAULTS,
  syncQuerySchema,
  syncResponseSchema,
  syncTaskSchema,
  TASK_AUDIT_ACTIONS,
  taskAssigneeOptionsSchema,
  taskDetailSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const AT = '2026-11-02T04:00:00.000Z';
const user = { id: ID, fullName: 'Nigar Səfərli' };

const detail = {
  id: ID,
  title: 'Soyuducunun qapısını təmir edin',
  priority: 'high',
  status: 'awaiting_review',
  site: { id: ID, name: 'Anbar №1' },
  assignee: user,
  team: { id: ID, name: 'Texniki xidmət' },
  assigneeInactive: false,
  createdBy: user,
  requiresReview: true,
  source: 'problem',
  problemId: ID,
  dueAt: AT,
  overdueAt: null,
  rev: 4,
  createdAt: AT,
  updatedAt: AT,
  instructions: 'Rezini dəyişin.',
  evidence: { photo: 'required', video: 'none', liveOnly: true },
  acceptedAt: AT,
  startedAt: AT,
  submittedAt: AT,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  media: [
    {
      id: ID, role: 'response', submissionId: ID, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 1000,
      width: 1600, height: 1200, durationMs: null, capturedAt: AT, capturedBy: user, status: 'uploaded', uploadedAt: AT,
    },
  ],
  submissions: [
    { id: ID, submittedBy: user, text: 'Hazırdır', mediaIds: [ID], submittedAt: AT, receivedAt: AT, reviewDecision: null, reviewComment: null, reviewedBy: null, reviewedAt: null },
  ],
  problem: {
    id: ID, executionId: ID, occurrenceId: ID, localDate: '2026-11-02', siteId: ID, siteName: 'Anbar №1', checklistId: ID,
    checklistName: 'Açılış', itemId: ID, itemLabel: 'Temperatur', source: 'manual', severity: 'critical', note: 'Qapı bağlanmır',
    mediaIds: [ID], media: [{ id: ID, kind: 'video', status: 'pending' }], executorName: 'Elvin', createdAt: AT, resolution: 'open',
    taskId: ID, executionState: 'partial',
  },
  history: [{ id: ID, fromStatus: 'in_progress', toStatus: 'awaiting_review', at: AT, actor: user, comment: null }],
  canManage: true,
  canReview: true,
};

describe('task read models', () => {
  it('parses a task detail and strips history and rights for the phone', () => {
    expect(taskDetailSchema.parse(detail)).toEqual(detail);
    const { history: _h, canManage: _m, canReview: _r, ...phone } = detail;
    expect(syncTaskSchema.parse(detail)).toEqual(phone);
  });

  it('adds tasks and removed ids to the sync response, and knownTaskIds to the query', () => {
    const { history: _h, canManage: _m, canReview: _r, ...phone } = detail;
    const r = syncResponseSchema.parse({ serverTime: AT, occurrences: [], checklistVersions: [], executions: [], tasks: [phone], removedTaskIds: [ID], unreadNotifications: 0 });
    expect(r.tasks[0]!.status).toBe('awaiting_review');
    expect(syncQuerySchema.parse({ knownTaskIds: `${ID},${ID}` })).toEqual({ knownVersionIds: [], knownTaskIds: [ID, ID] });
    expect(syncQuerySchema.safeParse({ knownTaskIds: Array(100).fill(ID).join(',') }).success).toBe(true);
    // Over the cap the ids are truncated, not refused (R20); knownVersionIds keeps failing the request.
    const over = syncQuerySchema.parse({ knownTaskIds: Array(101).fill(ID).join(',') });
    expect(over.knownTaskIds).toHaveLength(100);
    expect(syncQuerySchema.safeParse({ knownVersionIds: Array(201).fill(ID).join(',') }).success).toBe(false);
  });

  it('gives problems a resolution, a task link, the run state and each medium’s kind and status, with a resolution filter', () => {
    expect(problemDtoSchema.parse(detail.problem)).toMatchObject({ resolution: 'open', taskId: ID, executionState: 'partial', media: [{ id: ID, kind: 'video', status: 'pending' }] });
    expect(problemDtoSchema.safeParse({ ...detail.problem, media: [{ id: ID, kind: 'video', status: 'purged' }] }).success).toBe(false);
    expect(problemListQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', resolution: 'none' })).toMatchObject({ resolution: 'none' });
    expect(problemListQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30', resolution: 'fixed' }).success).toBe(false);
  });

  it('gives the assignee picker people, teams and the sites a task may name', () => {
    const options = { users: [{ id: ID, fullName: 'Nigar', jobTitle: null, kind: 'worker' }], teams: [{ id: ID, name: 'Texniki xidmət', memberCount: 2 }], sites: [{ id: ID, name: 'Anbar №1' }] };
    expect(taskAssigneeOptionsSchema.parse(options)).toEqual(options);
    expect(taskAssigneeOptionsSchema.safeParse({ users: [], teams: [] }).success).toBe(false);
  });

  it('registers the task error codes, permissions and audit actions', () => {
    expect(ERROR_HTTP_STATUS.TASK_ALREADY_TAKEN).toBe(409);
    expect(ERROR_HTTP_STATUS.TASK_STATE_INVALID).toBe(409);
    expect(ERROR_HTTP_STATUS.TASK_ASSIGNEE_INVALID).toBe(422);
    expect(ERROR_HTTP_STATUS.PROBLEM_NOT_CLOSED).toBe(409);
    expect(ERROR_HTTP_STATUS.PROBLEM_ALREADY_HAS_TASK).toBe(409);
    expect(ERROR_HTTP_STATUS.EVIDENCE_REQUIRED).toBe(422);
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['tasks.view', 'tasks.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toEqual(expect.arrayContaining(['tasks.view', 'tasks.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toContain('tasks.view');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).not.toContain('tasks.manage');
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
    expect(TASK_AUDIT_ACTIONS).toEqual(['task.created', 'task.updated', 'task.reassigned', 'task.cancelled', 'task.approved', 'task.rejected']);
  });
});

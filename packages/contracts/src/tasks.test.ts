import { describe, expect, it } from 'vitest';
import {
  cancelTaskSchema,
  createTaskSchema,
  DEFAULT_TASK_EVIDENCE,
  isFinalTaskStatus,
  problemResolutionOf,
  reviewTaskSchema,
  submissionSchema,
  TASK_ACTIONS,
  TASK_STATUSES,
  type TaskAction,
  taskAssigneeSchema,
  taskEvidenceMet,
  taskListQuerySchema,
  taskMediaRegisterSchema,
  type TaskStatus,
  TASK_LIMITS,
  taskTransition,
  updateTaskSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const AT = '2026-11-02T04:00:00.000Z';

/** [from, action, next with requiresReview, next without]. Spec §3. */
const TABLE: Array<[TaskStatus, TaskAction, TaskStatus | null, TaskStatus | null]> = [
  ['new', 'accept', 'accepted', 'accepted'],
  ['new', 'start', 'in_progress', 'in_progress'],
  ['new', 'submit', null, null],
  ['new', 'approve', null, null],
  ['new', 'reject', null, null],
  ['new', 'cancel', 'cancelled', 'cancelled'],
  ['new', 'reassign', 'new', 'new'],
  ['accepted', 'accept', null, null],
  ['accepted', 'start', 'in_progress', 'in_progress'],
  ['accepted', 'submit', null, null],
  ['accepted', 'approve', null, null],
  ['accepted', 'reject', null, null],
  ['accepted', 'cancel', 'cancelled', 'cancelled'],
  ['accepted', 'reassign', 'new', 'new'],
  ['in_progress', 'accept', null, null],
  ['in_progress', 'start', null, null],
  ['in_progress', 'submit', 'awaiting_review', 'completed'],
  ['in_progress', 'approve', null, null],
  ['in_progress', 'reject', null, null],
  ['in_progress', 'cancel', 'cancelled', 'cancelled'],
  ['in_progress', 'reassign', 'new', 'new'],
  ['awaiting_review', 'accept', null, null],
  ['awaiting_review', 'start', null, null],
  ['awaiting_review', 'submit', null, null],
  ['awaiting_review', 'approve', 'completed', 'completed'],
  ['awaiting_review', 'reject', 'in_progress', 'in_progress'],
  ['awaiting_review', 'cancel', 'cancelled', 'cancelled'],
  ['awaiting_review', 'reassign', 'new', 'new'],
  ...(['completed', 'cancelled'] as const).flatMap((s) => TASK_ACTIONS.map((a): [TaskStatus, TaskAction, null, null] => [s, a, null, null])),
];

describe('taskTransition', () => {
  it('lists every status and action exactly once', () => {
    const expected = TASK_STATUSES.flatMap((s) => TASK_ACTIONS.map((a) => `${s}:${a}`)).sort();
    expect(TABLE.map(([s, a]) => `${s}:${a}`).sort()).toEqual(expected);
  });

  it.each(TABLE)('%s + %s → %s with review, %s without', (status, action, withReview, withoutReview) => {
    expect(taskTransition(status, action, { requiresReview: true })).toBe(withReview);
    expect(taskTransition(status, action, { requiresReview: false })).toBe(withoutReview);
  });

  it('knows the final statuses', () => {
    expect(TASK_STATUSES.filter(isFinalTaskStatus)).toEqual(['completed', 'cancelled']);
  });
});

describe('taskEvidenceMet', () => {
  const photo = { kind: 'photo' as const };
  const video = { kind: 'video' as const };
  it.each([
    ['defaults need nothing', DEFAULT_TASK_EVIDENCE, [], { ok: true }],
    ['a required photo is there', { photo: 'required', video: 'none', liveOnly: true }, [photo], { ok: true }],
    ['a required photo is missing', { photo: 'required', video: 'optional', liveOnly: false }, [video], { ok: false, missing: ['photo'] }],
    ['both are missing, in kind order', { photo: 'required', video: 'required', liveOnly: false }, [], { ok: false, missing: ['photo', 'video'] }],
  ] as const)('%s', (_name, evidence, media, expected) => {
    expect(taskEvidenceMet(evidence, media)).toEqual(expected);
  });
});

describe('problemResolutionOf', () => {
  it('derives the resolution from the linked task (spec §5)', () => {
    expect(problemResolutionOf(null)).toBe('none');
    for (const s of ['new', 'accepted', 'in_progress', 'awaiting_review'] as const) expect(problemResolutionOf(s)).toBe('open');
    expect(problemResolutionOf('completed')).toBe('resolved');
    expect(problemResolutionOf('cancelled')).toBe('cancelled');
  });
});

describe('TASK_LIMITS', () => {
  it('caps known task ids at 100 so the sync URL stays short', () => {
    expect(TASK_LIMITS.knownTaskIds).toBe(100);
  });
});

describe('task input schemas', () => {
  it('fills create defaults and trims', () => {
    expect(createTaskSchema.parse({ id: ID, title: '  Qapını təmir edin ', assignee: { teamId: ID } })).toEqual({
      id: ID,
      title: 'Qapını təmir edin',
      instructions: '',
      priority: 'normal',
      siteId: null,
      dueAt: null,
      evidence: DEFAULT_TASK_EVIDENCE,
      assignee: { teamId: ID },
      problemId: null,
    });
  });

  it('enforces the spec §4 limits', () => {
    const base = { id: ID, title: 'x', assignee: { userId: ID } };
    expect(createTaskSchema.safeParse({ ...base, title: ' ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, title: 'x'.repeat(201) }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, title: 'x'.repeat(200), instructions: 'y'.repeat(5000) }).success).toBe(true);
    expect(createTaskSchema.safeParse({ ...base, instructions: 'y'.repeat(5001) }).success).toBe(false);
    expect(cancelTaskSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(cancelTaskSchema.safeParse({ reason: 'r'.repeat(1001) }).success).toBe(false);
    expect(submissionSchema.safeParse({ id: ID, submittedAt: AT, mediaIds: Array(14).fill(ID) }).success).toBe(false);
    expect(submissionSchema.parse({ id: ID, submittedAt: AT })).toEqual({ id: ID, text: '', mediaIds: [], submittedAt: AT });
    expect(updateTaskSchema.parse({})).toEqual({});
  });

  it('takes exactly one assignee', () => {
    expect(taskAssigneeSchema.safeParse({ userId: ID }).success).toBe(true);
    expect(taskAssigneeSchema.safeParse({ teamId: ID }).success).toBe(true);
    expect(taskAssigneeSchema.safeParse({ userId: ID, teamId: ID }).success).toBe(false);
    expect(taskAssigneeSchema.safeParse({}).success).toBe(false);
  });

  it('needs a comment to reject', () => {
    expect(reviewTaskSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    const r = reviewTaskSchema.safeParse({ decision: 'reject', comment: '  ' });
    expect(r.success).toBe(false);
    expect(r.error!.issues).toEqual([expect.objectContaining({ path: ['comment'], message: 'tasks.issues.commentRequired' })]);
  });

  it('parses list filters from the query string', () => {
    expect(taskListQuerySchema.parse({ status: 'new,in_progress', overdue: 'true', awaitingMyReview: 'false' })).toMatchObject({
      status: ['new', 'in_progress'],
      overdue: true,
      awaitingMyReview: false,
      limit: 50,
    });
    expect(taskListQuerySchema.safeParse({ status: 'late' }).success).toBe(false);
  });

  it('registers media with a role', () => {
    const m = { id: ID, role: 'response', kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, capturedAt: AT };
    expect(taskMediaRegisterSchema.parse(m)).toEqual(m);
    expect(taskMediaRegisterSchema.safeParse({ ...m, role: 'problem' }).success).toBe(false);
  });
});

import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { act, auditActions, captureTaskEvents, createTask, newTaskBody, registerTaskMedia, taskHistory, taskMediaBody, taskRow, taskWorld, videoExtra } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

describe('managing tasks', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('edits fields with a task.updated audit; others cannot, and final tasks cannot be edited', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const res = await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { title: 'Yeni ad', priority: 'high', requiresReview: true, siteId: w.siteId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ title: 'Yeni ad', priority: 'high', requiresReview: true, site: { id: w.siteId }, status: 'new', rev: 2 });
    expect(await auditActions(task.id)).toEqual(['task.created', 'task.updated']);
    expect(await taskHistory(task.id)).toHaveLength(1);
    expect((await w.workers[0].api.patch(`/api/v1/tasks/${task.id}`, { title: 'x' })).status).toBe(403);
    const foreign = await createTask(w.owner, newTaskBody({ userId: w.workers[2].id }));
    expect((await w.manager.api.patch(`/api/v1/tasks/${foreign.id}`, { title: 'x' })).status).toBe(404);
    await w.manager.api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: 'Lazım deyil' });
    const final = await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { title: 'x' });
    expect([final.status, final.body.error.code]).toEqual([409, 'TASK_STATE_INVALID']);
  });

  it('reassigning resets the task; the previous assignee’s later commands are refused', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const task = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    clock.set(T('04:20'));
    await act(w1.api, task.id, 'start', T('04:10'));
    const oldPhoto = await registerTaskMedia(w1.api, task.id, 'response');
    const events = captureTaskEvents(t);
    const res = await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { assignee: { userId: w2.id } });
    events.stop();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'new', assignee: { id: w2.id }, acceptedAt: null, startedAt: null });
    expect((await taskHistory(task.id)).at(-1)).toEqual(['in_progress', 'new', w.manager.id, null]);
    expect(await auditActions(task.id)).toEqual(['task.created', 'task.reassigned']);
    expect(events.seen).toEqual([['task.assigned', task.id, w.manager.id]]);
    // İşçi 1's commands, queued while offline, arrive now.
    expect((await act(w1.api, task.id, 'start', T('04:15'))).status).toBe(404);
    expect((await w1.api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), mediaIds: [oldPhoto], submittedAt: T('04:16') })).status).toBe(404);
    // İşçi 2 cannot hand in İşçi 1's photo.
    await act(w2.api, task.id, 'start', T('04:20'));
    const borrowed = await w2.api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), mediaIds: [oldPhoto], submittedAt: T('04:20') });
    expect([borrowed.status, borrowed.body.error.fields]).toEqual([400, { mediaIds: 'tasks.issues.unknownMedia' }]);
    // Reassigning to the current assignee is not a change.
    expect((await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { assignee: { userId: w2.id } })).body).toMatchObject({ status: 'in_progress' });
    expect(await auditActions(task.id)).toEqual(['task.created', 'task.reassigned']);
  });

  it('clears overdue only when the due date moves past now', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { dueAt: T('04:30') }));
    clock.set(T('05:00'));
    await ownerQuery("update tasks set overdue_at = '2026-11-02T04:30:00Z' where id = $1", [task.id]);
    expect((await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { dueAt: T('04:45') })).body).toMatchObject({ dueAt: T('04:45'), overdueAt: T('04:30') });
    expect((await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { dueAt: T('06:00') })).body).toMatchObject({ dueAt: T('06:00'), overdueAt: null });
    await ownerQuery("update tasks set overdue_at = '2026-11-02T04:30:00Z' where id = $1", [task.id]);
    expect((await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { dueAt: null })).body).toMatchObject({ dueAt: null, overdueAt: null });
  });

  it('cancels with a reason from an open status; nothing leaves cancelled', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    clock.set(T('04:20'));
    await act(w.workers[0].api, task.id, 'start', T('04:10'));
    const empty = await w.manager.api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: ' ' });
    expect([empty.status, empty.body.error.fields]).toEqual([400, { reason: 'errors.validation.required' }]);
    expect((await w.workers[0].api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: 'x' })).status).toBe(403);
    const events = captureTaskEvents(t);
    const res = await w.manager.api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: 'Artıq lazım deyil' });
    events.stop();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledAt: T('04:20'), cancelReason: 'Artıq lazım deyil' });
    expect((await taskHistory(task.id)).at(-1)).toEqual(['in_progress', 'cancelled', w.manager.id, 'Artıq lazım deyil']);
    expect(await auditActions(task.id)).toEqual(['task.created', 'task.cancelled']);
    expect(events.seen).toEqual([['task.cancelled', task.id, w.manager.id]]);
    const again = await w.manager.api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: 'Yenə' });
    expect([again.status, again.body.error.code]).toEqual([409, 'TASK_STATE_INVALID']);
  });

  it('rejects with a comment back to in_progress and approves to completed, reviewing the latest submission', async () => {
    const w = await taskWorld(t);
    const w1 = w.workers[0];
    const task = await createTask(w.manager.api, newTaskBody({ userId: w1.id }, { requiresReview: true }));
    clock.set(T('04:20'));
    await act(w1.api, task.id, 'start', T('04:10'));
    const photo1 = await registerTaskMedia(w1.api, task.id, 'response');
    const sub1 = uuidv7();
    await w1.api.post(`/api/v1/tasks/${task.id}/submissions`, { id: sub1, mediaIds: [photo1], submittedAt: T('04:15') });
    expect((await w1.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'approve' })).status).toBe(403);
    const bare = await w.manager.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'reject' });
    expect([bare.status, bare.body.error.fields]).toEqual([400, { comment: 'tasks.issues.commentRequired' }]);
    const events = captureTaskEvents(t);
    const rejected = await w.manager.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'reject', comment: 'Foto bulanıqdır' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body).toMatchObject({ status: 'in_progress', completedAt: null });
    expect(rejected.body.submissions[0]).toMatchObject({
      id: sub1,
      reviewDecision: 'rejected',
      reviewComment: 'Foto bulanıqdır',
      reviewedBy: { id: w.manager.id, fullName: 'Menecer' },
      reviewedAt: T('04:20'),
    });
    const reused = await w1.api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), mediaIds: [photo1], submittedAt: T('04:21') });
    expect([reused.status, reused.body.error.fields]).toEqual([400, { mediaIds: 'tasks.issues.unknownMedia' }]);
    clock.set(T('04:40'));
    const photo2 = await registerTaskMedia(w1.api, task.id, 'response');
    const sub2 = uuidv7();
    expect((await w1.api.post(`/api/v1/tasks/${task.id}/submissions`, { id: sub2, mediaIds: [photo2], submittedAt: T('04:35') })).body.status).toBe('awaiting_review');
    const approved = await w.manager.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'approve', comment: 'Əla' });
    events.stop();
    expect(approved.body).toMatchObject({ status: 'completed', completedAt: T('04:40') });
    expect(approved.body.submissions.map((s: { id: string; reviewDecision: string }) => [s.id, s.reviewDecision])).toEqual([
      [sub1, 'rejected'],
      [sub2, 'approved'],
    ]);
    expect((await taskHistory(task.id)).slice(-3)).toEqual([
      ['awaiting_review', 'in_progress', w.manager.id, 'Foto bulanıqdır'],
      ['in_progress', 'awaiting_review', w1.id, null],
      ['awaiting_review', 'completed', w.manager.id, 'Əla'],
    ]);
    expect(await auditActions(task.id)).toEqual(['task.created', 'task.rejected', 'task.approved']);
    expect(events.seen).toEqual([
      ['task.rejected', task.id, w.manager.id],
      ['task.submitted', task.id, w1.id],
      ['task.completed', task.id, w.manager.id],
    ]);
    const late = await w.manager.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'reject', comment: 'x' });
    expect([late.status, late.body.error.code]).toEqual([409, 'TASK_STATE_INVALID']);
  });

  it('leaves a PATCH that changes nothing untouched', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { dueAt: T('04:30'), priority: 'high' }));
    clock.set(T('05:00'));
    await ownerQuery("update tasks set overdue_at = '2026-11-02T04:30:00Z' where id = $1", [task.id]);
    const before = await taskRow(task.id);
    const res = await w.manager.api.patch(`/api/v1/tasks/${task.id}`, {
      title: task.title,
      instructions: task.instructions,
      priority: 'high',
      dueAt: T('04:30'),
      evidence: task.evidence,
      requiresReview: task.requiresReview,
      assignee: { userId: w.workers[0].id },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ rev: before.rev, overdueAt: T('04:30') });
    const after = await taskRow(task.id);
    expect([after.rev, after.updated_at, after.overdue_at]).toEqual([before.rev, before.updated_at, before.overdue_at]);
    expect(await auditActions(task.id)).toEqual(['task.created']);
    expect(await taskHistory(task.id)).toHaveLength(1);
  });

  it('does not let a previous assignee’s leftover media fill the new assignee’s registration cap', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const task = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    clock.set(T('04:20'));
    await act(w1.api, task.id, 'start', T('04:10'));
    // Room for retakes: max(3 × 3, 10) = 10 unsubmitted videos.
    for (let i = 0; i < 10; i++) await registerTaskMedia(w1.api, task.id, 'response', videoExtra);
    expect((await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { assignee: { userId: w2.id } })).status).toBe(200);
    await act(w2.api, task.id, 'start', T('04:20'));
    const res = await w2.api.post(`/api/v1/tasks/${task.id}/media`, taskMediaBody('response', videoExtra));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('accepts the unchanged assignee alongside other edits even after they were deactivated', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    expect((await w.owner.post(`/api/v1/users/${w.workers[0].id}/deactivate`)).status).toBe(200);
    const res = await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { title: 'Yeni ad', assignee: { userId: w.workers[0].id } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ title: 'Yeni ad', status: 'new', assignee: { id: w.workers[0].id }, assigneeInactive: true });
    expect(await auditActions(task.id)).toEqual(['task.created', 'task.updated']);
    const other = await w.manager.api.patch(`/api/v1/tasks/${task.id}`, { assignee: { userId: w.workers[1].id } });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });
});

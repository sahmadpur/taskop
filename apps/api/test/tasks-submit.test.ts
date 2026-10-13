import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { MONDAY_0800 } from './scheduling-fixtures';
import { act, captureTaskEvents, createTask, newTaskBody, registerTaskMedia, taskHistory, type TaskWorld, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;
const submitBody = (mediaIds: string[] = [], extra: Record<string, unknown> = {}) => ({ id: uuidv7(), text: 'Qapı təmir olundu', mediaIds, submittedAt: T('04:15'), ...extra });

describe('task submissions', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 started a task for them at 08:10 Baku; the clock reads 08:20. */
  async function startedTask(w: TaskWorld, over: Record<string, unknown> = {}): Promise<string> {
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, over));
    clock.set(T('04:20'));
    expect((await act(w.workers[0].api, task.id, 'start', T('04:10'))).status).toBe(200);
    return task.id;
  }

  it('completes a task without review, links its media, and records history and events', async () => {
    const w = await taskWorld(t);
    const id = await startedTask(w);
    const photo = await registerTaskMedia(w.workers[0].api, id, 'response');
    const events = captureTaskEvents(t);
    const body = submitBody([photo]);
    const res = await w.workers[0].api.post(`/api/v1/tasks/${id}/submissions`, body);
    events.stop();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', submittedAt: T('04:15'), completedAt: T('04:15'), rev: 4 });
    expect(res.body.submissions).toEqual([
      {
        id: body.id,
        submittedBy: { id: w.workers[0].id, fullName: 'İşçi 1' },
        text: 'Qapı təmir olundu',
        mediaIds: [photo],
        submittedAt: T('04:15'),
        receivedAt: T('04:20'),
        reviewDecision: null,
        reviewComment: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    ]);
    expect(res.body.media).toEqual([expect.objectContaining({ id: photo, role: 'response', submissionId: body.id })]);
    expect((await taskHistory(id)).at(-1)).toEqual(['in_progress', 'completed', w.workers[0].id, null]);
    expect(events.seen).toEqual([
      ['task.submitted', id, w.workers[0].id],
      ['task.completed', id, w.workers[0].id],
    ]);
  });

  it('is idempotent on the submission id, also after the task moved on to review', async () => {
    const w = await taskWorld(t);
    const id = await startedTask(w, { requiresReview: true });
    const body = submitBody();
    const first = await w.workers[0].api.post(`/api/v1/tasks/${id}/submissions`, body);
    expect(first.body).toMatchObject({ status: 'awaiting_review', completedAt: null });
    const again = await w.workers[0].api.post(`/api/v1/tasks/${id}/submissions`, body);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.submissions).toHaveLength(1);
    expect((await taskHistory(id)).filter(([, to]) => to === 'awaiting_review')).toHaveLength(1);
  });

  it('refuses missing evidence, foreign, instruction or repeated media, too many photos, the wrong status and future times', async () => {
    const w = await taskWorld(t);
    const api = w.workers[0].api;
    const id = await startedTask(w, { evidence: { photo: 'required', video: 'optional', liveOnly: false } });
    const post = (body: object) => api.post(`/api/v1/tasks/${id}/submissions`, body);
    const missing = await post(submitBody());
    expect([missing.status, missing.body.error.code, missing.body.error.fields]).toEqual([422, 'EVIDENCE_REQUIRED', { 'evidence.photo': 'tasks.issues.photoRequired' }]);

    const other = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await act(api, other.id, 'start', T('04:20'));
    const foreign = await registerTaskMedia(api, other.id, 'response');
    const instruction = await registerTaskMedia(w.manager.api, id, 'instruction');
    const photo = await registerTaskMedia(api, id, 'response');
    for (const mediaIds of [[foreign], [instruction], [photo, photo]]) {
      const res = await post(submitBody(mediaIds));
      expect([res.status, res.body.error.fields], JSON.stringify(mediaIds)).toEqual([400, { mediaIds: 'tasks.issues.unknownMedia' }]);
    }
    const eleven: string[] = [];
    for (let i = 0; i < 11; i++) eleven.push(await registerTaskMedia(api, id, 'response'));
    const many = await post(submitBody(eleven));
    expect([many.status, many.body.error.fields]).toEqual([400, { mediaIds: 'tasks.issues.tooManyMedia' }]);

    const accepted = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await act(api, accepted.id, 'accept', T('04:20'));
    const early = await api.post(`/api/v1/tasks/${accepted.id}/submissions`, submitBody());
    expect([early.status, early.body.error.code]).toEqual([409, 'TASK_STATE_INVALID']);
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    const unaccepted = await api.post(`/api/v1/tasks/${team.id}/submissions`, submitBody());
    expect([unaccepted.status, unaccepted.body.error.code]).toEqual([409, 'TASK_STATE_INVALID']);

    const ahead = await post(submitBody([photo], { submittedAt: '2026-11-02T04:22:00.001Z' }));
    expect([ahead.status, ahead.body.error.code]).toEqual([422, 'CLOCK_INVALID']);
    // Before the start: raised to the start time.
    expect((await post(submitBody([photo], { submittedAt: T('04:00') }))).body).toMatchObject({ status: 'completed', submittedAt: T('04:10') });
  });
});

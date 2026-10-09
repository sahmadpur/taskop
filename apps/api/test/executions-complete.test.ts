import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, completeExecution, executionRow, fullAnswers, historyOf, photoBody, registerPhoto, startedExecution, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('completion (POST /executions/:id/complete)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const started = () => startedExecution(t, clock);

  it('refuses to complete while requirements are unmet and stores nothing', async () => {
    const { w, executionId, api } = await started();
    const res = await completeExecution(api, executionId, 1, { [w.c.problem.id]: { optionIds: [w.c.yes.id] } }, '2026-11-02T04:20:00.000Z');
    expect([res.status, res.body.error.code]).toEqual([422, 'REQUIREMENTS_UNMET']);
    expect(res.body.error.missing).toEqual([
      { itemId: w.c.problem.id, kind: 'photo' },
      { itemId: w.c.comment.id, kind: 'answer' },
      { itemId: w.c.temp.id, kind: 'answer' },
      { itemId: w.c.photo.id, kind: 'answer' },
    ]);
    expect(await executionRow(executionId)).toMatchObject({ state: 'active', answers_rev: 0, completed_at: null });
  });

  it('completes inside the window, freezes score and problems, and counts a photo not yet uploaded', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T05:00:00Z');
    const answers = { ...fullAnswers(w, photo), [w.c.temp.id]: { number: 10, note: 'Kondisioner xarabdır' } };
    const res = await completeExecution(api, executionId, 1, answers, '2026-11-02T04:55:00.000Z');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId,
      state: 'completed',
      completedAt: '2026-11-02T04:55:00.000Z',
      late: false,
      progress: { answered: 3, total: 4, requiredMissing: 0 },
      score: { earned: 1, possible: 2, percent: 50, problems: [{ itemId: w.c.temp.id, severity: 'normal' }] },
    });
    expect(await statusOf(w.occurrenceId)).toBe('completed');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['started', 'completed', '2026-11-02T04:55:00.000Z', null, w.workers[0].id]);
    expect((await executionRow(executionId)).completed_received_at!.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((await ownerQuery('select item_id, source from execution_problems where execution_id = $1', [executionId])).rows).toEqual([{ item_id: w.c.temp.id, source: 'rule' }]);

    const again = await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T04:56:00.000Z');
    expect(again.body).toEqual(res.body);
    expect((await historyOf(w.occurrenceId)).filter((h) => h[1] === 'completed')).toHaveLength(1);
    const more = await api.post(`/api/v1/executions/${executionId}/media`, photoBody(w.c.photo.id));
    expect([more.status, more.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('marks a completion after due_at late', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T06:40:00Z');
    expect((await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T06:30:00.000Z')).body).toMatchObject({ state: 'completed', late: true });
  });

  it('records a completion at or after closes_at as partial', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:01:00Z');
    const res = await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T07:00:00.000Z');
    expect(res.body).toMatchObject({ state: 'partial', completedAt: '2026-11-02T07:00:00.000Z', late: true });
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['started', 'partial', '2026-11-02T07:00:00.000Z', null, w.workers[0].id]);
  });

  it('a stale answers command arriving after completion is ignored, not refused', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    expect((await completeExecution(api, executionId, 3, fullAnswers(w, photo), '2026-11-02T04:20:00.000Z')).body.state).toBe('completed');
    const late = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(2, { [w.c.temp.id]: { number: 4 } }, '2026-11-02T04:18:00.000Z'));
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ rev: 3, stale: true, state: 'completed' });
    const newer = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(4, { [w.c.temp.id]: { number: 4 } }, '2026-11-02T04:20:00.000Z'));
    expect([newer.status, newer.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('a worker removed from the snapshot after starting can still answer and complete', async () => {
    const { w, executionId, api } = await started();
    expect((await w.owner.put(`/api/v1/users/${w.workers[0].id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    await ownerQuery('delete from occurrence_assignees where occurrence_id = $1 and user_id = $2', [w.occurrenceId, w.workers[0].id]);
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    expect((await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:20:00.000Z'))).status).toBe(200);
    expect((await completeExecution(api, executionId, 2, fullAnswers(w, photo), '2026-11-02T04:20:00.000Z')).body.state).toBe('completed');
  });

  it('stores the completion of a rejected execution without touching the occurrence', async () => {
    const { w } = await started();
    const w1 = w.workers[1];
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z');
    await w1.api.post('/api/v1/executions', lost);
    const res = await completeExecution(w1.api, lost.id, 1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:19:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'rejected', completedAt: '2026-11-02T04:19:00.000Z' });
    expect(await executionRow(lost.id)).toMatchObject({ answers_rev: 1, answers: { [w.c.temp.id]: { number: 5 } } });
    expect(await statusOf(w.occurrenceId)).toBe('started');
  });
});

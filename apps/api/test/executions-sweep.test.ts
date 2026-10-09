import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, completeExecution, executionRow, executionWorld, fullAnswers, historyOf, registerPhoto, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('sweep to partial and late revival', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: OccurrenceJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(OccurrenceJobs);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 started at 08:10 Baku and registered the required photo; the sweep then runs at 11:00 (closes_at). */
  async function sweptAtClose() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    return { w, executionId, api, photo };
  }

  it('an unfinished execution becomes partial at closes_at, once', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await w.workers[0].api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:15:00.000Z'));
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['in_progress', 'partial', '2026-11-02T07:00:00.000Z', null, null]);
    expect(await executionRow(executionId)).toMatchObject({ state: 'partial', completed_at: null, answers_rev: 1 });
  });

  it('a completion just before closes_at revives an execution the sweep made partial', async () => {
    const { w, executionId, api, photo } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const res = await completeExecution(api, executionId, 5, fullAnswers(w, photo), '2026-11-02T06:59:59.999Z');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ state: 'completed', completedAt: '2026-11-02T06:59:59.999Z', late: true });
    expect(await statusOf(w.occurrenceId)).toBe('completed');
    expect((await historyOf(w.occurrenceId)).slice(-2)).toEqual([
      ['started', 'partial', '2026-11-02T07:00:00.000Z', null, null],
      ['partial', 'completed', '2026-11-02T06:59:59.999Z', 'late_sync', w.workers[0].id],
    ]);
  });

  it('the occurrence detail lists a late-synced history in the order it happened, not by device time', async () => {
    const { w, executionId, api, photo } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    expect((await completeExecution(api, executionId, 5, fullAnswers(w, photo), '2026-11-02T06:59:59.000Z')).status).toBe(200);
    const detail = await w.owner.get(`/api/v1/occurrences/${w.occurrenceId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const steps = detail.body.history.map((h: { fromStatus: string | null; toStatus: string; at: string }) => [h.fromStatus, h.toStatus, h.at]);
    expect(steps.slice(-3)).toEqual([
      ['pending', 'started', '2026-11-02T04:10:00.000Z'],
      ['started', 'partial', '2026-11-02T07:00:00.000Z'],
      ['partial', 'completed', '2026-11-02T06:59:59.000Z'],
    ]);
  });

  it('a photo registered after the sweep (captured before closes_at) lets a late completion revive it', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    clock.set('2026-11-02T07:30:00Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id, { capturedAt: '2026-11-02T06:50:00.000Z', deviceTime: '2026-11-02T06:50:00.000Z' });
    const res = await completeExecution(api, executionId, 5, fullAnswers(w, photo), '2026-11-02T06:55:00.000Z');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ state: 'completed', late: true });
    expect(await statusOf(w.occurrenceId)).toBe('completed');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['partial', 'completed', '2026-11-02T06:55:00.000Z', 'late_sync', w.workers[0].id]);
  });

  it('a completion at exactly closes_at stays partial', async () => {
    const { w, executionId, api, photo } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const before = (await historyOf(w.occurrenceId)).length;
    const res = await completeExecution(api, executionId, 5, fullAnswers(w, photo), '2026-11-02T07:00:00.000Z');
    expect(res.body).toMatchObject({ state: 'partial', completedAt: '2026-11-02T07:00:00.000Z' });
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    const history = await historyOf(w.occurrenceId);
    expect(history).toHaveLength(before);
    expect(history.at(-1)).toEqual(['started', 'partial', '2026-11-02T07:00:00.000Z', null, null]);
  });

  it('a late completion after closes_at keeps the occurrence partial, stores no answers and adds no history row', async () => {
    const { w, executionId, api, photo } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const before = (await historyOf(w.occurrenceId)).length;
    const res = await completeExecution(api, executionId, 5, fullAnswers(w, photo), '2026-11-02T07:20:00.000Z');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ state: 'partial', completedAt: '2026-11-02T07:20:00.000Z', late: true });
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    expect(await historyOf(w.occurrenceId)).toHaveLength(before);
    // Answers made after the window closed are not stored on a swept execution.
    const row = await executionRow(executionId);
    expect(row).toMatchObject({ state: 'partial', answers_rev: 0, answers: {} });
    expect(row.completed_at!.toISOString()).toBe('2026-11-02T07:20:00.000Z');
  });

  it('keeps answers captured before closes_at that arrive after the sweep, and refuses later ones', async () => {
    const { w, executionId, api } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const inWindow = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T06:50:00.000Z'));
    expect(inWindow.status, JSON.stringify(inWindow.body)).toBe(200);
    expect(inWindow.body).toMatchObject({ rev: 1, stale: false, state: 'partial', progress: { answered: 1, total: 4, requiredMissing: 2 } });
    const after = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(2, { [w.c.temp.id]: { number: 6 } }, '2026-11-02T07:05:00.000Z'));
    expect([after.status, after.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
  });

  it('completes a fully offline execution of a missed occurrence in one late sync', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T09:00:00Z');
    await jobs.sweepAll([w.s.tenantId]);
    expect(await statusOf(w.occurrenceId)).toBe('missed');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:30:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id, { capturedAt: '2026-11-02T04:40:00.000Z', deviceTime: '2026-11-02T04:40:00.000Z' });
    const res = await completeExecution(api, executionId, 5, fullAnswers(w, photo), '2026-11-02T05:00:00.000Z');
    expect(res.body).toMatchObject({ state: 'completed', late: false });
    expect((await historyOf(w.occurrenceId)).slice(-2)).toEqual([
      ['missed', 'started', '2026-11-02T04:30:00.000Z', 'late_sync', w.workers[0].id],
      ['started', 'completed', '2026-11-02T05:00:00.000Z', null, w.workers[0].id],
    ]);
  });
});

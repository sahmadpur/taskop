import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents, type DomainEventMap } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { answersBody, startedExecution } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { createAssignment, MONDAY_0800, schedulingWorld } from './scheduling-fixtures';

function capture<K extends keyof DomainEventMap>(t: TestApp, name: K) {
  const seen: DomainEventMap[K][] = [];
  const stop = t.app.get(DomainEvents).on(name, (e) => void seen.push(e));
  return { seen, stop };
}

describe('notification domain events', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('emits assignment.assignees_changed on create and on updates that add people, only for the added ones', async () => {
    const w = await schedulingWorld(t);
    const events = capture(t, 'assignment.assignees_changed');
    const a = await createAssignment(w);
    expect(events.seen).toHaveLength(1);
    expect(events.seen[0]).toMatchObject({ tenantId: w.s.tenantId, assignmentId: a.id, actorUserId: w.s.ownerId });
    expect([...events.seen[0]!.addedUserIds].sort()).toEqual([...w.workers].sort());
    events.seen.length = 0;
    expect((await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, name: 'Yeni ad' })).status).toBe(200);
    expect((await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 2, assigneeIds: [w.workers[0]] })).status).toBe(200);
    expect(events.seen).toEqual([]);
    const third = await createUserDirect(t, w.s.tenantId, { fullName: 'İşçi 3' });
    expect((await w.api.put(`/api/v1/users/${third.id}/sites`, { siteIds: [w.siteId] })).status).toBe(200);
    const res = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 3, assigneeIds: [w.workers[0], w.workers[1], third.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    events.stop();
    expect(events.seen.map((e) => [...e.addedUserIds].sort())).toEqual([[w.workers[1], third.id].sort()]);
  });

  it('emits problem.recorded for problems a save inserts, not for re-saves of the same problem', async () => {
    const { w, executionId, api } = await startedExecution(t, clock);
    const events = capture(t, 'problem.recorded');
    const at = '2026-11-02T04:20:00.000Z';
    const save = (rev: number, temp: Record<string, unknown>) => api.put(`/api/v1/executions/${executionId}/answers`, answersBody(rev, { [w.c.temp.id]: temp }, at));
    expect((await save(1, { number: 10, note: 'isti' })).status).toBe(200);
    expect(events.seen).toEqual([
      { tenantId: w.s.tenantId, problemId: expect.any(String), occurrenceId: w.occurrenceId, severity: 'normal', actorUserId: w.workers[0].id },
    ]);
    const ruleProblem = events.seen[0]!.problemId;
    expect((await save(2, { number: 12, note: 'çox isti' })).status).toBe(200);
    expect(events.seen).toHaveLength(1);
    const res = await save(3, { number: 12, note: 'çox isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    events.stop();
    expect(events.seen).toHaveLength(2);
    expect(events.seen[1]).toMatchObject({ severity: 'critical', occurrenceId: w.occurrenceId });
    expect(events.seen[1]!.problemId).not.toBe(ruleProblem);
  });
});

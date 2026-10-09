import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createAssignment, daily, fixed, MONDAY_0800, occurrenceRows, type SchedulingWorld, schedulingWorld, TODAY } from './scheduling-fixtures';

describe('scheduling tenant isolation', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let A: SchedulingWorld;
  let B: SchedulingWorld;
  const a: Record<string, string> = {};
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    A = await schedulingWorld(t);
    B = await schedulingWorld(t);
    a.shift = (await A.api.post('/api/v1/shifts', { name: 'A', startTime: '08:00', endTime: '16:00' })).body.id;
    a.assignment = (await createAssignment(A)).id;
    a.occurrence = (await occurrenceRows(a.assignment))[0]!.id;
  });
  afterAll(() => t.close());

  it.each([
    ['PATCH', () => `/api/v1/shifts/${a.shift}`, { name: 'x' }],
    ['GET', () => `/api/v1/assignments/${a.assignment}`, undefined],
    ['PUT', () => `/api/v1/assignments/${a.assignment}`, { revision: 1, name: 'x' }],
    ['POST', () => `/api/v1/assignments/${a.assignment}/pause`, {}],
    ['POST', () => `/api/v1/assignments/${a.assignment}/resume`, {}],
    ['POST', () => `/api/v1/assignments/${a.assignment}/end`, {}],
    ['GET', () => `/api/v1/occurrences/${a.occurrence}`, undefined],
    ['POST', () => `/api/v1/occurrences/${a.occurrence}/cancel`, { reason: 'x' }],
  ] as const)('%s on a foreign id returns 404', async (method, url, body) => {
    const path = url();
    const res =
      method === 'GET'
        ? await B.api.get(path)
        : method === 'POST'
          ? await B.api.post(path, body)
          : method === 'PUT'
            ? await B.api.put(path, body)
            : await B.api.patch(path, body);
    expect(res.status, `${method} ${path}`).toBe(404);
  });

  it('rejects foreign ids inside request bodies with 422 REFERENCE_NOT_FOUND', async () => {
    const base = { checklistId: B.checklistId, siteId: B.siteId, assigneeIds: B.workers, schedule: daily(), timing: fixed() };
    const cases = [
      await B.api.post('/api/v1/assignments', { ...base, checklistId: A.checklistId }),
      await B.api.post('/api/v1/assignments', { ...base, siteId: A.siteId }),
      await B.api.post('/api/v1/assignments', { ...base, assigneeIds: A.workers }),
      await B.api.post('/api/v1/assignments', { ...base, timing: { mode: 'shift', shiftId: a.shift, graceMinutes: 0 } }),
      await B.api.post('/api/v1/assignments/preview', { siteId: A.siteId, schedule: daily(), timing: fixed() }),
      await B.api.post('/api/v1/shifts', { name: 'x', startTime: '08:00', endTime: '16:00', siteId: A.siteId }),
      await B.api.put('/api/v1/roster', { siteId: A.siteId, from: TODAY, to: TODAY, rows: [] }),
      await B.api.post('/api/v1/roster/copy', { siteId: A.siteId, sourceWeekStart: TODAY, targetWeekStarts: ['2026-11-09'] }),
    ];
    for (const res of cases) {
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe('REFERENCE_NOT_FOUND');
    }
  });

  it('never lists the other tenant', async () => {
    expect((await B.api.get('/api/v1/assignments?limit=200')).body.items.map((x: { id: string }) => x.id)).not.toContain(a.assignment);
    expect((await B.api.get(`/api/v1/occurrences?from=${TODAY}&to=2026-11-30&limit=200`)).body.items.map((x: { id: string }) => x.id)).not.toContain(a.occurrence);
    expect((await B.api.get('/api/v1/shifts')).body.map((x: { id: string }) => x.id)).not.toContain(a.shift);
    const roster = (await B.api.get(`/api/v1/roster?siteId=${A.siteId}&from=${TODAY}&to=2026-11-08`)).body;
    expect(roster).toMatchObject({ users: [], rows: [] });
  });
});

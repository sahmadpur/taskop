import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, claimOk, type ExecutionWorld, executionWorld, photoBody, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('execution tenant isolation', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let A: ExecutionWorld;
  let B: ExecutionWorld;
  const a: Record<string, string> = {};
  const at = '2026-11-02T04:20:00.000Z';
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    A = await executionWorld(t);
    B = await executionWorld(t);
    clock.set(at);
    a.execution = await claimOk(A.workers[0].api, A.occurrenceId, '2026-11-02T04:10:00.000Z');
    a.media = await registerPhoto(A.workers[0].api, a.execution, A.c.photo.id);
    await A.workers[0].api.put(`/api/v1/executions/${a.execution}/answers`, answersBody(1, { [A.c.temp.id]: { number: 30 } }, at));
  });
  afterAll(() => t.close());

  it.each([
    ['GET', () => `/api/v1/executions/${a.execution}`, undefined],
    ['PUT', () => `/api/v1/executions/${a.execution}/answers`, answersBody(2, {}, at)],
    ['POST', () => `/api/v1/executions/${a.execution}/complete`, { rev: 2, answers: {}, completedAt: at, deviceTime: at, clientOffsetMs: 0 }],
    ['POST', () => `/api/v1/executions/${a.execution}/media`, photoBody(null)],
    ['POST', () => `/api/v1/media/${a.media}/uploaded`, {}],
    ['GET', () => `/api/v1/media/${a.media}/url`, undefined],
  ] as const)('%s on a foreign id returns 404', async (method, url, body) => {
    for (const api of [B.owner, B.workers[0].api]) {
      const path = url();
      const res = method === 'GET' ? await api.get(path) : method === 'PUT' ? await api.put(path, body!) : await api.post(path, body ?? {});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('refuses a claim on a foreign occurrence and never lists the other tenant', async () => {
    expect((await B.workers[0].api.post('/api/v1/executions', claimBody(A.occurrenceId, at))).status).toBe(404);
    const sync = (await B.workers[0].api.get('/api/v1/me/sync')).body;
    expect(sync.occurrences.map((o: { id: string }) => o.id)).not.toContain(A.occurrenceId);
    expect(sync.executions).toEqual([]);
    expect((await B.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items).toEqual([]);
    expect((await A.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items).toHaveLength(1);
  });
});

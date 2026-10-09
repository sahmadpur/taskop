import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimOk, type ExecutionWorld, executionWorld, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('execution data scope', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: ExecutionWorld;
  let executionId: string;
  let photo: string;
  const RANGE = 'from=2026-11-01&to=2026-11-30';
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    photo = await registerPhoto(w.workers[0].api, executionId, w.c.photo.id);
    await w.workers[0].api.put(`/api/v1/executions/${executionId}/answers`, {
      rev: 1,
      answers: { [w.c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Qapı sınıqdır', mediaIds: [] } } },
      deviceTime: '2026-11-02T04:20:00.000Z',
      clientOffsetMs: 0,
    });
  });
  afterAll(() => t.close());

  const staff = async (opts: { roleKey?: 'manager' | 'auditor'; roleId?: string }, siteIds: string[]) => {
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', emailVerified: true, ...opts });
    if (siteIds.length) await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds });
    return as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
  };

  it('lets an all-scope auditor read everything and a site manager only their sites', async () => {
    const auditor = await staff({ roleKey: 'auditor' }, []);
    expect((await auditor.get(`/api/v1/executions/${executionId}`)).status).toBe(200);
    expect((await auditor.get(`/api/v1/problems?${RANGE}`)).body.items).toHaveLength(1);
    const outside = await staff({ roleKey: 'manager' }, [w.otherSiteId]);
    expect((await outside.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await outside.get(`/api/v1/media/${photo}/url`)).status).toBe(404);
    expect((await outside.get(`/api/v1/problems?${RANGE}`)).body.items).toEqual([]);
    expect((await outside.get(`/api/v1/occurrences/${w.occurrenceId}`)).status).toBe(404);
  });

  it('needs assignments.view to read someone else’s execution even with the occurrence in scope', async () => {
    const noView = (await w.owner.post('/api/v1/roles', { name: uniq('Baxmır'), dataScope: 'all', permissions: ['checklists.view'] })).body.id as string;
    const u = await staff({ roleId: noView }, []);
    expect((await u.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await u.get(`/api/v1/problems?${RANGE}`)).status).toBe(403);
  });

  it('never lets one worker read another worker’s execution or media', async () => {
    const other = w.workers[1].api;
    expect((await other.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await other.get(`/api/v1/media/${photo}/url`)).status).toBe(404);
    expect((await other.post(`/api/v1/media/${photo}/uploaded`)).status).toBe(403);
  });
});

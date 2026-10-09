import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimBody, claimOk, executionWorld, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff } from './fixtures';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('web reads of executions and problems', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 completes at 08:20 with a rule and a manual problem on the temperature; İşçi 2's claim lost. */
  async function scenario() {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z');
    await w1.api.post('/api/v1/executions', lost);
    const photo = await registerPhoto(w0.api, executionId, w.c.photo.id);
    const answers = {
      [w.c.problem.id]: { optionIds: [w.c.no.id] },
      [w.c.temp.id]: { number: 10, note: 'isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } },
      [w.c.photo.id]: { photos: [photo] },
    };
    const res = await w0.api.post(`/api/v1/executions/${executionId}/complete`, {
      rev: 1,
      answers,
      completedAt: '2026-11-02T04:20:00.000Z',
      deviceTime: '2026-11-02T04:20:00.000Z',
      clientOffsetMs: 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { w, executionId, lostId: lost.id, photo, answers };
  }
  async function manager(w: Awaited<ReturnType<typeof scenario>>['w'], siteId: string) {
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] });
    return as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
  }

  it('adds the counted and the rejected executions to the occurrence detail and list', async () => {
    const { w, executionId, lostId } = await scenario();
    const detail = (await w.owner.get(`/api/v1/occurrences/${w.occurrenceId}`)).body;
    expect(detail.execution).toEqual({
      id: executionId,
      executor: { id: w.workers[0].id, fullName: 'İşçi 1' },
      state: 'completed',
      rejectedReason: null,
      startedAt: '2026-11-02T04:10:00.000Z',
      startedReceivedAt: '2026-11-02T04:20:00.000Z',
      completedAt: '2026-11-02T04:20:00.000Z',
      completedReceivedAt: '2026-11-02T04:20:00.000Z',
      late: false,
      clockSuspect: false,
      progress: { answered: 3, total: 4, requiredMissing: 0 },
      scorePercent: 50,
      problemCount: 2,
      mediaPending: 1,
    });
    expect(detail.rejectedExecutions).toEqual([
      expect.objectContaining({ id: lostId, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED', executor: { id: w.workers[1].id, fullName: 'İşçi 2' }, problemCount: 0 }),
    ]);
    const list = (await w.owner.get(`/api/v1/occurrences?from=2026-11-02&to=2026-11-03&assignmentId=${w.assignmentId}`)).body.items;
    expect(list[0].executionBrief).toEqual({
      executionId,
      executorName: 'İşçi 1',
      state: 'completed',
      progress: { answered: 3, total: 4, requiredMissing: 0 },
      scorePercent: 50,
      late: false,
      clockSuspect: false,
    });
    expect(list[1].executionBrief).toBeNull();
  });

  it('returns an execution to its executor and in-scope viewers only', async () => {
    const { w, executionId, lostId, photo, answers } = await scenario();
    const res = await w.owner.get(`/api/v1/executions/${executionId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: executionId,
      state: 'completed',
      versionNumber: 1,
      checklistVersionId: w.versionId,
      answers,
      answersRev: 1,
      score: { percent: 50 },
      clockOffsetMs: 0,
      device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
      occurrence: { id: w.occurrenceId, status: 'completed' },
      media: [{ id: photo, itemId: w.c.photo.id, kind: 'photo', source: 'camera', status: 'pending', capturedBy: { id: w.workers[0].id, fullName: 'İşçi 1' } }],
    });
    expect(res.body.content.sections[0].items).toHaveLength(4);
    expect(res.body.problems.map((p: { source: string; severity: string; note: string }) => [p.source, p.severity, p.note])).toEqual([
      ['rule', 'normal', 'isti'],
      ['manual', 'critical', 'Kondisioner xarabdır'],
    ]);
    expect((await w.workers[0].api.get(`/api/v1/executions/${executionId}`)).status).toBe(200);
    expect((await w.workers[1].api.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await w.workers[1].api.get(`/api/v1/executions/${lostId}`)).body).toMatchObject({ state: 'rejected', rejectedReason: 'ALREADY_CLAIMED' });
    expect((await (await manager(w, w.siteId)).get(`/api/v1/executions/${executionId}`)).status).toBe(200);
    expect((await (await manager(w, w.otherSiteId)).get(`/api/v1/executions/${executionId}`)).status).toBe(404);
  });

  it('lists problems newest first with filters, labels, a cursor and a 92-day range', async () => {
    const { w } = await scenario();
    const get = (qs: string) => w.owner.get(`/api/v1/problems?from=2026-11-01&to=2026-11-30${qs}`);
    const all = (await get('')).body;
    expect(all.items.map((p: { itemLabel: string; source: string; severity: string }) => [p.itemLabel, p.source, p.severity])).toEqual([
      ['Temperatur', 'manual', 'critical'],
      ['Temperatur', 'rule', 'normal'],
    ]);
    expect(all.items[0]).toMatchObject({
      occurrenceId: w.occurrenceId,
      localDate: '2026-11-02',
      siteId: w.siteId,
      siteName: 'Filial 1',
      checklistId: w.checklistId,
      checklistName: 'İcra yoxlaması',
      executorName: 'İşçi 1',
      note: 'Kondisioner xarabdır',
      mediaIds: [],
    });
    expect((await get('&severity=critical')).body.items).toHaveLength(1);
    expect((await get('&source=rule')).body.items).toHaveLength(1);
    expect((await get(`&siteId=${w.otherSiteId}`)).body.items).toHaveLength(0);
    expect((await get(`&checklistId=${w.checklistId}`)).body.items).toHaveLength(2);
    const page1 = (await get('&limit=1')).body;
    expect(page1.items).toHaveLength(1);
    const page2 = (await get(`&limit=1&cursor=${page1.nextCursor}`)).body;
    expect([page2.items[0].source, page2.nextCursor]).toEqual(['rule', null]);
    expect((await w.owner.get('/api/v1/problems?from=2026-12-01&to=2026-12-31')).body.items).toEqual([]);
    const long = await w.owner.get('/api/v1/problems?from=2026-11-01&to=2027-02-01');
    expect([long.status, long.body.error.fields]).toEqual([400, { to: 'executions.issues.rangeTooLong' }]);
    expect((await w.workers[0].api.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).status).toBe(403);
    expect((await (await manager(w, w.otherSiteId)).get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items).toEqual([]);
  });
});

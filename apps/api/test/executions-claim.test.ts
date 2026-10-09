import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { claimBody, claimOk, executionRow, executionWorld, historyOf, occurrenceOn, pinnedVersionOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, daily, MONDAY_0800, TODAY } from './scheduling-fixtures';

const TUESDAY = '2026-11-03';
const WEDNESDAY = '2026-11-04';

describe('claims (POST /executions)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('starts an occurrence, pins its version and records the executor', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    clock.set('2026-11-02T04:10:00Z');
    const body = claimBody(w.occurrenceId, '2026-11-02T04:05:00.000Z');
    const res = await w0.api.post('/api/v1/executions', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId: body.id,
      state: 'active',
      reason: null,
      claim: { executionId: body.id, executorUserId: w0.id, executorName: 'İşçi 1' },
      checklistVersionId: w.versionId,
      startedAt: '2026-11-02T04:05:00.000Z',
      clockSuspect: false,
    });
    const occ = await ownerQuery<{ status: string; v: string }>('select status, checklist_version_id as v from occurrences where id = $1', [w.occurrenceId]);
    expect(occ.rows[0]).toEqual({ status: 'started', v: w.versionId });
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['pending', 'started', '2026-11-02T04:05:00.000Z', null, w0.id]);
    const row = await executionRow(body.id);
    expect(row).toMatchObject({ state: 'active', executor_user_id: w0.id, late: false, answers_rev: 0, progress: { answered: 0, total: 4, requiredMissing: 3 } });
    expect(row.started_received_at.toISOString()).toBe('2026-11-02T04:10:00.000Z');
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:10:00Z');
    const [a, b] = await Promise.all(w.workers.map((x) => x.api.post('/api/v1/executions', claimBody(w.occurrenceId, '2026-11-02T04:09:00.000Z'))));
    expect([a!.status, b!.status]).toEqual([200, 200]);
    expect([a!.body.state, b!.body.state].sort()).toEqual(['active', 'rejected']);
    const [winner, loser] = a!.body.state === 'active' ? [a!.body, b!.body] : [b!.body, a!.body];
    expect(loser).toMatchObject({ reason: 'ALREADY_CLAIMED', claim: { executionId: winner.executionId } });
    const states = await ownerQuery<{ state: string }>('select state from executions where occurrence_id = $1 order by state', [w.occurrenceId]);
    expect(states.rows.map((r) => r.state)).toEqual(['active', 'rejected']);
    expect((await historyOf(w.occurrenceId)).filter((h) => h[1] === 'started')).toHaveLength(1);
  });

  it('stores a later offline claim as rejected, even when its device start was earlier', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:30:00Z');
    await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:20:00.000Z');
    const late = claimBody(w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const res = await w1.api.post('/api/v1/executions', late);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'rejected', reason: 'ALREADY_CLAIMED', claim: { executorUserId: w0.id, executorName: 'İşçi 1' } });
    expect(await executionRow(late.id)).toMatchObject({ state: 'rejected', rejected_reason: 'ALREADY_CLAIMED', executor_user_id: w1.id });
  });

  it('a claim replayed after the server rejected it returns the stored rejection', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:30:00Z');
    const winner = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:20:00.000Z');
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:25:00.000Z');
    expect((await w1.api.post('/api/v1/executions', lost)).body).toMatchObject({ state: 'rejected', reason: 'ALREADY_CLAIMED' });
    // Support releases the winner's claim: a fresh evaluation would now accept the lost claim.
    await ownerQuery("update executions set state = 'rejected', rejected_reason = 'NOT_STARTABLE' where id = $1", [winner]);
    await ownerQuery("update occurrences set status = 'pending' where id = $1", [w.occurrenceId]);
    const replay = await w1.api.post('/api/v1/executions', lost);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ executionId: lost.id, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: null });
    expect((await ownerQuery('select id from executions where occurrence_id = $1', [w.occurrenceId])).rowCount).toBe(2);
    expect(await statusOf(w.occurrenceId)).toBe('pending');
  });

  it('replays an accepted claim without a second history row, and refuses the same id from someone else', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:10:00Z');
    const body = claimBody(w.occurrenceId, '2026-11-02T04:05:00.000Z');
    const first = await w.workers[0].api.post('/api/v1/executions', body);
    const again = await w.workers[0].api.post('/api/v1/executions', body);
    expect(again.body).toEqual(first.body);
    expect((await historyOf(w.occurrenceId)).filter((h) => h[1] === 'started')).toHaveLength(1);
    const stolen = await w.workers[1].api.post('/api/v1/executions', body);
    expect([stolen.status, stolen.body.error.code]).toEqual([403, 'NOT_EXECUTOR']);
  });

  it('does not pin the checklist version for a rejected claim, but stores the current one on the row', async () => {
    const w = await executionWorld(t);
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const outsiderApi = as(t, (await loginWorker(t, w.s.orgCode, outsider.username!, outsider.secret)).accessToken);
    expect(await pinnedVersionOf(w.occurrenceId)).toBeNull();
    clock.set('2026-11-02T04:30:00Z');
    const body = claimBody(w.occurrenceId, '2026-11-02T04:20:00.000Z');
    const res = await outsiderApi.post('/api/v1/executions', body);
    expect(res.body).toMatchObject({ state: 'rejected', reason: 'NOT_ASSIGNED', checklistVersionId: w.versionId });
    expect(await pinnedVersionOf(w.occurrenceId)).toBeNull();
    await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:25:00.000Z');
    expect(await pinnedVersionOf(w.occurrenceId)).toBe(w.versionId);
  });

  it('stores every canStart failure as a rejected claim', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const outsiderApi = as(t, (await loginWorker(t, w.s.orgCode, outsider.username!, outsider.secret)).accessToken);
    const tuesday = await occurrenceOn(w.assignmentId, TUESDAY);
    const wednesday = await occurrenceOn(w.assignmentId, WEDNESDAY);
    expect((await w.owner.post(`/api/v1/occurrences/${wednesday}/cancel`, { reason: 'Bayram' })).status).toBe(200);
    const shift = (await w.owner.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id as string;
    await w.owner.put('/api/v1/roster', { siteId: w.siteId, from: TODAY, to: TODAY, rows: [{ userId: w0.id, shiftId: shift, date: TODAY }] });
    const shiftAssignment = await w.owner.post('/api/v1/assignments', {
      checklistId: w.checklistId,
      siteId: w.siteId,
      assigneeIds: [w0.id],
      schedule: daily(),
      timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 },
    });
    expect(shiftAssignment.status, JSON.stringify(shiftAssignment.body)).toBe(201);
    const shiftOccurrence = await occurrenceOn(shiftAssignment.body.id, TODAY);
    await ownerQuery('delete from shift_roster where user_id = $1', [w0.id]);

    const reasonOf = async (api: Api, occurrenceId: string, at: string) => {
      clock.set(at);
      const res = await api.post('/api/v1/executions', claimBody(occurrenceId, at));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.state).toBe('rejected');
      return res.body.reason as string;
    };
    expect(await reasonOf(outsiderApi, w.occurrenceId, '2026-11-02T04:30:00.000Z')).toBe('NOT_ASSIGNED');
    expect(await reasonOf(w0.api, shiftOccurrence, '2026-11-02T04:30:00.000Z')).toBe('NOT_ON_SHIFT');
    expect(await reasonOf(w0.api, tuesday, '2026-11-02T05:00:00.000Z')).toBe('NOT_YET_OPEN');
    expect(await reasonOf(w0.api, tuesday, '2026-11-03T07:30:00.000Z')).toBe('CLOSED');
    expect(await reasonOf(w0.api, wednesday, '2026-11-04T04:30:00.000Z')).toBe('NOT_STARTABLE');
    const unknown = await w0.api.post('/api/v1/executions', claimBody('0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', '2026-11-04T04:30:00.000Z'));
    expect(unknown.status).toBe(404);
  });

  it('revives a missed occurrence from a late-synced offline start, but not one started after it closed', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    const tuesday = await occurrenceOn(w.assignmentId, TUESDAY);
    clock.set('2026-11-03T08:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    expect(await statusOf(w.occurrenceId)).toBe('missed');
    const res = await w0.api.post('/api/v1/executions', claimBody(w.occurrenceId, '2026-11-02T04:30:00.000Z'));
    expect(res.body).toMatchObject({ state: 'active', reason: null });
    expect((await historyOf(w.occurrenceId)).slice(1)).toEqual([
      ['pending', 'overdue', '2026-11-02T06:00:00.000Z', null, null],
      ['overdue', 'missed', '2026-11-02T07:00:00.000Z', null, null],
      ['missed', 'started', '2026-11-02T04:30:00.000Z', 'late_sync', w0.id],
    ]);
    const closed = await w1.api.post('/api/v1/executions', claimBody(tuesday, '2026-11-03T07:30:00.000Z'));
    expect(closed.body).toMatchObject({ state: 'rejected', reason: 'CLOSED' });
    expect(await statusOf(tuesday)).toBe('missed');
  });

  it('refuses device times more than 2 minutes ahead of the server and stores nothing', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:10:00Z');
    for (const body of [
      claimBody(w.occurrenceId, '2026-11-02T04:12:00.001Z'),
      claimBody(w.occurrenceId, '2026-11-02T04:05:00.000Z', { deviceTime: '2026-11-02T04:12:30.000Z' }),
    ]) {
      const res = await api.post('/api/v1/executions', body);
      expect([res.status, res.body.error.code]).toEqual([422, 'CLOCK_INVALID']);
    }
    expect((await ownerQuery('select id from executions where occurrence_id = $1', [w.occurrenceId])).rowCount).toBe(0);
    expect((await api.post('/api/v1/executions', claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z'))).body.state).toBe('active');
  });

  it.each([
    ['2026-11-02T03:58:00.000Z', 0, '2026-11-02T04:00:00.000Z', false],
    ['2026-11-02T03:50:00.000Z', 0, '2026-11-02T04:00:00.000Z', true],
    ['2026-11-02T04:05:00.000Z', 6 * 60_000, '2026-11-02T04:05:00.000Z', true],
    ['2026-11-02T04:05:00.000Z', -4 * 60_000, '2026-11-02T04:05:00.000Z', false],
  ])('stores start %s with offset %d as %s, clock suspect %s', async (startedAt, clientOffsetMs, stored, suspect) => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:10:00Z');
    const res = await w.workers[0].api.post('/api/v1/executions', claimBody(w.occurrenceId, startedAt, { clientOffsetMs }));
    expect(res.body).toMatchObject({ state: 'active', startedAt: stored, clockSuspect: suspect });
    expect((await historyOf(w.occurrenceId)).at(-1)![2]).toBe(stored);
  });
});

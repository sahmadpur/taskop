import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { EligibilityService } from '../src/scheduling/eligibility.service';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld, TODAY } from './scheduling-fixtures';

const RANGE = `from=${TODAY}&to=2026-11-30`;

describe('occurrences', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('lists in start order and pages with a cursor', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await w.api.get(`/api/v1/occurrences?${RANGE}&assignmentId=${a.id}&limit=4${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      seen.push(...res.body.items.map((o: { localDate: string }) => o.localDate));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(15);
    expect([...seen].sort()).toEqual(seen);
    expect(new Set(seen).size).toBe(15);
  });

  it('filters by status, site, checklist and assignee, and limits the range', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { assigneeIds: [w.workers[0]] });
    const count = async (q: string) => (await w.api.get(`/api/v1/occurrences?${RANGE}&limit=200&${q}`)).body.items.length;
    expect(await count(`assignmentId=${a.id}&status=pending,overdue`)).toBe(15);
    expect(await count(`assignmentId=${a.id}&status=missed`)).toBe(0);
    expect(await count(`siteId=${w.otherSiteId}`)).toBe(0);
    expect(await count(`checklistId=${w.checklistId}`)).toBe(15);
    expect(await count(`assigneeId=${w.workers[1]}`)).toBe(0);
    const long = await w.api.get(`/api/v1/occurrences?from=${TODAY}&to=2027-02-01`);
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toEqual({ to: 'scheduling.issues.rangeTooLong' });
  });

  it('shows details with history and cancels one occurrence with a reason', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const id = (await occurrenceRows(a.id))[1]!.id;
    const detail = (await w.api.get(`/api/v1/occurrences/${id}`)).body;
    expect(detail.assignees.map((u: { fullName: string }) => u.fullName)).toEqual(['İşçi 1', 'İşçi 2']);
    expect(detail.history).toEqual([
      { fromStatus: null, toStatus: 'pending', at: '2026-11-02T04:00:00.000Z', actor: { kind: 'user', name: 'Elvin Əhmədov' }, reason: null },
    ]);
    expect((await w.api.post(`/api/v1/occurrences/${id}/cancel`, { reason: '' })).status).toBe(400);
    const cancelled = await w.api.post(`/api/v1/occurrences/${id}/cancel`, { reason: 'Bayram günü' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Bayram günü', unassigned: false });
    expect(cancelled.body.history.at(-1)).toMatchObject({ fromStatus: 'pending', toStatus: 'cancelled', reason: 'Bayram günü', actor: { kind: 'user' } });
    expect((await w.api.post(`/api/v1/occurrences/${id}/cancel`, { reason: 'x' })).body.error.code).toBe('OCCURRENCE_NOT_CANCELLABLE');
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1', [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['occurrence.cancelled']);
  });

  it('refuses to cancel an overdue occurrence whose window has closed', async () => {
    const w = await schedulingWorld(t);
    const [first] = await occurrenceRows((await createAssignment(w)).id);
    await ownerQuery("update occurrences set status = 'overdue' where id = $1", [first!.id]);
    clock.set('2026-11-02T07:00:00Z'); // 11:00: the window closed, the sweep has not run yet
    const res = await w.api.post(`/api/v1/occurrences/${first!.id}/cancel`, { reason: 'Gec' });
    expect(res.body.error.code).toBe('OCCURRENCE_NOT_CANCELLABLE');
    clock.set('2026-11-02T06:59:00Z');
    expect((await w.api.post(`/api/v1/occurrences/${first!.id}/cancel`, { reason: 'Gec' })).status).toBe(200);
  });

  it('flags unassigned occurrences once nobody is eligible', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    for (const id of w.workers) await w.api.post(`/api/v1/users/${id}/deactivate`);
    const items = (await w.api.get(`/api/v1/occurrences?${RANGE}&assignmentId=${a.id}&limit=3`)).body.items;
    // Today's window opened at 08:00 = now, so its snapshot is frozen.
    expect(items.map((o: { unassigned: boolean }) => o.unassigned)).toEqual([false, true, true]);
  });

  it('lets a worker list only their own occurrences', async () => {
    const w = await schedulingWorld(t);
    const me = await createUserDirect(t, w.s.tenantId, { fullName: 'Mən' });
    await w.api.put(`/api/v1/users/${me.id}/sites`, { siteIds: [w.siteId] });
    await createAssignment(w, { assigneeIds: [me.id] });
    await createAssignment(w, { assigneeIds: [w.workers[0]] });
    const api = as(t, (await loginWorker(t, w.s.orgCode, me.username!, me.secret)).accessToken);
    const mine = await api.get(`/api/v1/me/occurrences?${RANGE}&limit=200`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.items).toHaveLength(15);
    expect(mine.body.items.every((o: { assigneeIds: string[] }) => o.assigneeIds.includes(me.id))).toBe(true);
    expect((await api.get(`/api/v1/occurrences?${RANGE}`)).status).toBe(403);
  });

  it('answers canStart for sub-project 4', async () => {
    const w = await schedulingWorld(t);
    const [w0] = w.workers as [string, string];
    const outsider = await createUserDirect(t, w.s.tenantId);
    const [first, second] = await occurrenceRows((await createAssignment(w)).id);
    await w.api.post(`/api/v1/occurrences/${second!.id}/cancel`, { reason: 'x' });
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.put('/api/v1/roster', { siteId: w.siteId, from: TODAY, to: TODAY, rows: [{ userId: w0, shiftId: shift, date: TODAY }] });
    const shiftFirst = (await occurrenceRows((await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } })).id))[0]!;
    await ownerQuery('delete from shift_roster where user_id = $1', [w0]);

    const db = t.app.get(DbService);
    const elig = t.app.get(EligibilityService);
    const check = (occurrenceId: string, userId: string, iso: string) => db.withTenant(w.s.tenantId, null, () => elig.canStart(occurrenceId, userId, new Date(iso)));
    expect(await check(first!.id, w0, '2026-11-02T04:30:00Z')).toEqual({ ok: true, late: false });
    expect(await check(first!.id, w0, '2026-11-02T06:30:00Z')).toEqual({ ok: true, late: true });
    expect(await check(first!.id, w0, '2026-11-02T07:00:00Z')).toEqual({ ok: false, reason: 'CLOSED' });
    expect(await check(first!.id, w0, '2026-11-02T03:00:00Z')).toEqual({ ok: false, reason: 'NOT_YET_OPEN' });
    expect(await check(first!.id, outsider.id, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_ASSIGNED' });
    expect(await check(second!.id, w0, '2026-11-03T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
    expect(await check(shiftFirst.id, w0, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_ON_SHIFT' });
    expect(await check('0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', w0, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, fixed, live, MONDAY_0800, occurrenceRows, schedulingWorld, TODAY } from './scheduling-fixtures';

const sorted = (ids: string[]) => [...ids].sort();

describe('changing assignments', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('edit keeps the open occurrence and does not duplicate today', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    clock.set('2026-11-02T04:30:00Z'); // 08:30: today's 08:00 occurrence is open
    const res = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, timing: fixed('09:00') });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.revision).toBe(2);
    const rows = await occurrenceRows(a.id);
    const today = rows.filter((r) => r.local_date === TODAY);
    expect(today.map((r) => [r.status, r.starts_at.toISOString()])).toEqual([['pending', '2026-11-02T04:00:00.000Z']]);
    const cancelled = rows.filter((r) => r.status === 'cancelled');
    expect(cancelled).toHaveLength(14);
    expect(cancelled.every((r) => r.cancel_reason === 'assignment_edited')).toBe(true);
    const future = live(rows).filter((r) => r.local_date > TODAY);
    expect(future).toHaveLength(14);
    expect(future[0]!.starts_at.toISOString()).toBe('2026-11-03T05:00:00.000Z');

    const stale = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, name: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 });
  });

  it('a name-only edit regenerates nothing; an assignee-only edit refreshes future snapshots', async () => {
    const w = await schedulingWorld(t);
    const [w0] = w.workers as [string, string];
    const a = await createAssignment(w);
    await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, name: 'Yeni ad' });
    expect((await occurrenceRows(a.id)).filter((r) => r.status === 'cancelled')).toHaveLength(0);
    clock.set('2026-11-02T04:30:00Z');
    const res = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 2, assigneeIds: [w0] });
    expect(res.body.assignees.map((u: { id: string }) => u.id)).toEqual([w0]);
    const rows = await occurrenceRows(a.id);
    expect(rows[0]!.assignees).toEqual(sorted(w.workers)); // open: snapshot frozen
    expect(rows.slice(1).every((r) => r.assignees.length === 1 && r.assignees[0] === w0)).toBe(true);
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1 order by occurred_at, id', [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['assignment.created', 'assignment.updated', 'assignment.updated']);
  });

  it('pauses, resumes from now on, and ends for good', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    clock.set('2026-11-02T04:30:00Z');
    expect((await w.api.post(`/api/v1/assignments/${a.id}/pause`)).body.status).toBe('paused');
    let rows = await occurrenceRows(a.id);
    expect(live(rows).map((r) => r.local_date)).toEqual([TODAY]);
    expect(rows.filter((r) => r.cancel_reason === 'assignment_paused')).toHaveLength(14);

    clock.set('2026-11-03T04:30:00Z'); // Tuesday 08:30: today's slot already started, so it is not recreated
    const resumed = await w.api.post(`/api/v1/assignments/${a.id}/resume`);
    expect(resumed.body).toMatchObject({ status: 'active', revision: 3 });
    rows = await occurrenceRows(a.id);
    expect(live(rows).map((r) => r.local_date)).toEqual([TODAY, ...Array.from({ length: 14 }, (_, i) => `2026-11-${String(4 + i).padStart(2, '0')}`)]);

    expect((await w.api.post(`/api/v1/assignments/${a.id}/end`)).body.status).toBe('ended');
    expect((await w.api.post(`/api/v1/assignments/${a.id}/resume`)).body.error.code).toBe('ASSIGNMENT_ENDED');
    expect((await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 4, name: 'x' })).body.error.code).toBe('ASSIGNMENT_ENDED');
    const audit = await ownerQuery<{ action: string }>("select action from audit_log where entity_id = $1 and action <> 'assignment.created' order by occurred_at, id", [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['assignment.paused', 'assignment.resumed', 'assignment.ended']);
  });

  it('auto-pauses when the checklist is deactivated and does not resume on reactivation', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    await w.api.post(`/api/v1/checklists/${w.checklistId}/deactivate`);
    expect((await w.api.get(`/api/v1/assignments/${a.id}`)).body.status).toBe('paused');
    const rows = await occurrenceRows(a.id);
    expect(rows.filter((r) => r.cancel_reason === 'checklist_deactivated')).toHaveLength(14);
    await w.api.post(`/api/v1/checklists/${w.checklistId}/reactivate`);
    expect((await w.api.get(`/api/v1/assignments/${a.id}`)).body.status).toBe('paused');
    const audit = await ownerQuery<{ action: string }>("select action from audit_log where entity_id = $1 and action = 'assignment.auto_paused'", [a.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('user access changes refresh snapshots and future roster rows', async () => {
    const w = await schedulingWorld(t);
    const [w0, w1] = w.workers as [string, string];
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: TODAY,
      to: '2026-11-08',
      rows: ['2026-11-02', '2026-11-03', '2026-11-04'].flatMap((date) => [
        { userId: w0, shiftId: shift, date },
        { userId: w1, shiftId: shift, date },
      ]),
    });
    const fixedA = await createAssignment(w);
    const shiftA = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } });

    clock.set('2026-11-02T04:30:00Z');
    await w.api.post(`/api/v1/users/${w1}/deactivate`);
    let rows = await occurrenceRows(fixedA.id);
    expect(rows[0]!.assignees).toEqual(sorted([w0, w1])); // open: unchanged
    expect(rows[1]!.assignees).toEqual([w0]);
    // Deactivation also dropped w1's roster rows from today on.
    const deactivatedRoster = await ownerQuery<{ n: number }>('select count(*)::int as n from shift_roster where user_id = $1', [w1]);
    expect(deactivatedRoster.rows[0]!.n).toBe(0);
    await w.api.post(`/api/v1/users/${w1}/reactivate`);
    expect((await occurrenceRows(fixedA.id))[1]!.assignees).toEqual(sorted([w0, w1]));

    // Re-roster w1, then move them to the other site: their roster rows and future snapshots go.
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: '2026-11-03',
      to: '2026-11-04',
      rows: ['2026-11-03', '2026-11-04'].flatMap((date) => [
        { userId: w0, shiftId: shift, date },
        { userId: w1, shiftId: shift, date },
      ]),
    });
    expect((await occurrenceRows(shiftA.id))[1]!.assignees).toEqual(sorted([w0, w1]));
    await w.api.put(`/api/v1/users/${w1}/sites`, { siteIds: [w.otherSiteId] });
    const roster = await ownerQuery<{ n: number }>('select count(*)::int as n from shift_roster where user_id = $1', [w1]);
    expect(roster.rows[0]!.n).toBe(0);
    rows = await occurrenceRows(shiftA.id);
    expect(rows[1]!.assignees).toEqual([w0]);
    expect(rows[3]!.assignees).toEqual([]);
    expect((await occurrenceRows(fixedA.id))[1]!.assignees).toEqual([w0]);
  });

  it('a roster change refreshes shift-based snapshots for that site and range', async () => {
    const w = await schedulingWorld(t);
    const [, w1] = w.workers as [string, string];
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const a = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } });
    expect((await occurrenceRows(a.id))[3]!.assignees).toEqual([]);
    await w.api.put('/api/v1/roster', { siteId: w.siteId, from: '2026-11-05', to: '2026-11-05', rows: [{ userId: w1, shiftId: shift, date: '2026-11-05' }] });
    expect((await occurrenceRows(a.id))[3]!.assignees).toEqual([w1]);
  });

  it('regenerates future occurrences when a shift’s hours change', async () => {
    const w = await schedulingWorld(t);
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const a = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } });
    clock.set('2026-11-02T04:30:00Z');
    await w.api.patch(`/api/v1/shifts/${shift}`, { startTime: '09:00', endTime: '17:00' });
    const rows = await occurrenceRows(a.id);
    expect(rows.filter((r) => r.cancel_reason === 'shift_changed')).toHaveLength(14);
    expect(live(rows).find((r) => r.local_date === '2026-11-03')!.starts_at.toISOString()).toBe('2026-11-03T05:00:00.000Z');
    // A rename alone regenerates nothing.
    await w.api.patch(`/api/v1/shifts/${shift}`, { name: 'Səhər növbəsi' });
    expect((await occurrenceRows(a.id)).filter((r) => r.status === 'cancelled')).toHaveLength(14);
  });
});

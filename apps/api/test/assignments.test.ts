import { addDays } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { OccurrenceWriter } from '../src/scheduling/occurrence-writer';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import {
  createAssignment,
  daily,
  fixed,
  MONDAY_0800,
  occurrenceRows,
  type SchedulingWorld,
  schedulingWorld,
  staffWithRole,
  TODAY,
} from './scheduling-fixtures';

const sorted = (ids: string[]) => [...ids].sort();

describe('assignments', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const post = (w: SchedulingWorld, body: Record<string, unknown> = {}) =>
    w.api.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.siteId, assigneeIds: w.workers, schedule: daily(), timing: fixed(), ...body });

  it('creates an assignment and materialises 14 days ahead with snapshots and history', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { name: 'Səhər açılışı' });
    expect(a).toMatchObject({ name: 'Səhər açılışı', status: 'active', revision: 1, checklistId: w.checklistId, siteName: 'Filial 1', shiftName: null });
    expect(a.assignees.map((u) => u.fullName)).toEqual(['İşçi 1', 'İşçi 2']);
    expect(a.upcoming.map((o) => o.localDate)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(a.upcoming[0]).toMatchObject({
      status: 'pending',
      startsAt: '2026-11-02T04:00:00.000Z',
      dueAt: '2026-11-02T06:00:00.000Z',
      closesAt: '2026-11-02T07:00:00.000Z',
      unassigned: false,
      checklistName: 'Açılış yoxlaması',
    });

    const rows = await occurrenceRows(a.id);
    expect(rows.map((r) => r.local_date)).toEqual(Array.from({ length: 15 }, (_, i) => addDays(TODAY, i)));
    for (const r of rows) expect(r).toMatchObject({ status: 'pending', assignees: sorted(w.workers) });
    const meta = await ownerQuery<{ materialized_until: Date }>('select materialized_until from assignments where id = $1', [a.id]);
    expect(meta.rows[0]!.materialized_until.toISOString()).toBe('2026-11-16T20:00:00.000Z');
    const history = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from occurrence_status_history h join occurrences o on o.id = h.occurrence_id
        where o.assignment_id = $1 and h.from_status is null and h.to_status = 'pending' and h.actor_user_id = $2`,
      [a.id, w.s.ownerId],
    );
    expect(history.rows[0]!.n).toBe(15);
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1', [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['assignment.created']);
  });

  it('includes today’s slot while its window is open and skips it once closed', async () => {
    const w = await schedulingWorld(t);
    clock.set('2026-11-02T05:30:00Z'); // 09:30, after the start, before the 11:00 close
    expect((await occurrenceRows((await createAssignment(w)).id))[0]!.local_date).toBe(TODAY);
    clock.set('2026-11-02T07:30:00Z'); // 11:30, closed
    const rows = await occurrenceRows((await createAssignment(w)).id);
    expect(rows[0]!.local_date).toBe('2026-11-03');
    expect(rows).toHaveLength(14);
  });

  it('snapshots only rostered assignees for shift timing', async () => {
    const w = await schedulingWorld(t);
    const [w0, w1] = w.workers as [string, string];
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: TODAY,
      to: '2026-11-08',
      rows: [
        { userId: w0, shiftId: shift, date: '2026-11-02' },
        { userId: w0, shiftId: shift, date: '2026-11-03' },
        { userId: w1, shiftId: shift, date: '2026-11-03' },
      ],
    });
    const a = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 30 } });
    expect(a.shiftName).toBe('Səhər');
    const rows = await occurrenceRows(a.id);
    expect(rows.slice(0, 3).map((r) => r.assignees)).toEqual([[w0], sorted([w0, w1]), []]);
    expect(a.upcoming[0]).toMatchObject({ startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T12:00:00.000Z', closesAt: '2026-11-02T12:30:00.000Z' });
    expect(a.upcoming.map((o) => o.unassigned)).toEqual([false, false, true, true, true]);
  });

  it('lists and reads assignments with filters', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { name: 'Səhər açılışı' });
    expect((await w.api.get(`/api/v1/assignments?siteId=${w.siteId}`)).body.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect((await w.api.get('/api/v1/assignments?q=açılış')).body.items).toHaveLength(1);
    expect((await w.api.get('/api/v1/assignments?status=paused')).body.items).toHaveLength(0);
    expect((await w.api.get(`/api/v1/assignments?assigneeId=${w.workers[0]}`)).body.items).toHaveLength(1);
    expect((await w.api.get(`/api/v1/assignments/${a.id}`)).body.id).toBe(a.id);
    expect((await w.api.get('/api/v1/assignments/0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f')).status).toBe(404);
  });

  it('validates checklist, site, assignees, shift, schedule and window', async () => {
    const w = await schedulingWorld(t);
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const notAtSite = await post(w, { assigneeIds: [w.workers[0], outsider.id] });
    expect(notAtSite.body.error).toMatchObject({ code: 'ASSIGNEE_NOT_AT_SITE', userIds: [outsider.id] });

    const draftOnly = (await w.api.post('/api/v1/checklists', { name: 'Qaralama' })).body.id;
    expect((await post(w, { checklistId: draftOnly })).body.error.code).toBe('CHECKLIST_NOT_PUBLISHED');

    const invalid = await post(w, { schedule: daily('2026-11-10', { endDate: '2026-11-01' }) });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error).toMatchObject({ code: 'SCHEDULE_INVALID', issues: [{ path: ['schedule', 'endDate'], code: 'scheduling.issues.endBeforeStart' }] });
    expect((await post(w, { schedule: { kind: 'once', date: '2026-10-01' } })).body.error.code).toBe('SCHEDULE_EMPTY');
    expect((await post(w, { assigneeIds: [] })).status).toBe(400);

    const otherShift = (await w.api.post('/api/v1/shifts', { name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: w.otherSiteId })).body.id;
    expect((await post(w, { timing: { mode: 'shift', shiftId: otherShift, graceMinutes: 0 } })).body.error.code).toBe('SHIFT_NOT_AT_SITE');
    const off = (await w.api.post('/api/v1/shifts', { name: 'Off', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.patch(`/api/v1/shifts/${off}`, { active: false });
    expect((await post(w, { timing: { mode: 'shift', shiftId: off, graceMinutes: 0 } })).body.error.code).toBe('SHIFT_INACTIVE');

    // 25h windows need assignments.extended_window; nobody gets more than 7 days.
    const manager = await staffWithRole(t, w, 'manager', [w.siteId]);
    const long = { checklistId: w.checklistId, siteId: w.siteId, assigneeIds: w.workers, schedule: daily(), timing: fixed('08:00', 1440, 60) };
    expect((await manager.api.post('/api/v1/assignments', long)).body.error.code).toBe('WINDOW_TOO_LONG');
    expect((await w.api.post('/api/v1/assignments', long)).status).toBe(201);
    expect((await post(w, { timing: fixed('08:00', 10080, 1) })).body.error.code).toBe('WINDOW_INVALID');

    await w.api.post(`/api/v1/users/${w.workers[1]}/deactivate`);
    expect((await post(w)).body.error).toMatchObject({ code: 'ASSIGNEE_INACTIVE', userIds: [w.workers[1]] });
    await w.api.post(`/api/v1/checklists/${w.checklistId}/deactivate`);
    expect((await post(w, { assigneeIds: [w.workers[0]] })).body.error.code).toBe('CHECKLIST_DEACTIVATED');
  });

  it('generates midnight slots on later runs', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { timing: fixed('00:00', 60, 0) });
    const lastDate = async () => (await occurrenceRows(a.id)).at(-1)!.local_date;
    const histories = async () =>
      (await ownerQuery<{ n: number }>('select count(*)::int as n from occurrence_status_history h join occurrences o on o.id = h.occurrence_id where o.assignment_id = $1', [a.id])).rows[0]!.n;
    const run = () => t.app.get(DbService).withTenant(w.s.tenantId, null, () => t.app.get(OccurrenceWriter).materialize(a.id));
    const first = (await occurrenceRows(a.id)).length;
    expect(first).toBe(14); // today's 00:00 window is already closed at 08:00
    expect(await lastDate()).toBe('2026-11-16');
    clock.set('2026-11-03T04:00:00Z');
    expect(await run()).toBe(1);
    expect(await lastDate()).toBe('2026-11-17');
    const before = await histories();
    expect(await run()).toBe(0);
    expect(await histories()).toBe(before);
  });

  it('refuses inactive sites', async () => {
    const w = await schedulingWorld(t);
    await w.api.patch(`/api/v1/sites/${w.siteId}`, { active: false });
    expect((await post(w)).body.error.code).toBe('SITE_INACTIVE');
  });

  it('previews slots and warnings without saving anything', async () => {
    const w = await schedulingWorld(t);
    const res = await w.api.post('/api/v1/assignments/preview', { siteId: w.siteId, schedule: daily(TODAY, { skipDates: ['2026-10-01'] }), timing: fixed() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.slots).toHaveLength(20);
    expect(res.body.slots[0]).toEqual({ localDate: TODAY, startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z' });
    expect(res.body.warnings).toEqual(['SKIP_DATE_OUT_OF_RANGE']);

    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const noRoster = await w.api.post('/api/v1/assignments/preview', { siteId: w.siteId, schedule: daily(), timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 }, assigneeIds: w.workers });
    expect(noRoster.body.warnings).toEqual(['NO_ROSTERED_ASSIGNEES']);
    const past = await w.api.post('/api/v1/assignments/preview', { siteId: w.siteId, schedule: { kind: 'once', date: '2026-10-01' }, timing: fixed() });
    expect(past.body).toEqual({ slots: [], warnings: [] });

    const count = await ownerQuery<{ n: number }>('select count(*)::int as n from assignments where tenant_id = $1', [w.s.tenantId]);
    expect(count.rows[0]!.n).toBe(0);
  });

  it('needs checklists.view and assignments.manage to create', async () => {
    const w = await schedulingWorld(t);
    const auditor = await staffWithRole(t, w, 'auditor', []);
    expect((await auditor.api.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.siteId, assigneeIds: w.workers, schedule: daily(), timing: fixed() })).status).toBe(403);
    expect((await auditor.api.get('/api/v1/assignments')).status).toBe(200);
  });
});

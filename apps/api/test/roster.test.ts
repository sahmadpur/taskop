import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import { schedulingWorld } from './scheduling-fixtures';

describe('roster', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function world() {
    const w = await schedulingWorld(t, 2);
    const morning = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id as string;
    const night = (await w.api.post('/api/v1/shifts', { name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: w.otherSiteId })).body.id as string;
    return { w, morning, night };
  }

  it('replaces a site’s rows for a range and reads them back', async () => {
    const { w, morning } = await world();
    const [w0, w1] = w.workers as [string, string];
    const body = {
      siteId: w.siteId,
      from: '2026-11-02',
      to: '2026-11-08',
      rows: [
        { userId: w0, shiftId: morning, date: '2026-11-02' },
        { userId: w1, shiftId: morning, date: '2026-11-02' },
        { userId: w0, shiftId: morning, date: '2026-11-03' },
      ],
    };
    const put = await w.api.put('/api/v1/roster', body);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.rows).toHaveLength(3);
    expect(put.body.users.map((u: { fullName: string }) => u.fullName)).toEqual(['İşçi 1', 'İşçi 2']);
    expect(put.body.shifts.map((s: { name: string }) => s.name)).toEqual(['Səhər']);

    const again = await w.api.put('/api/v1/roster', { ...body, rows: [{ userId: w1, shiftId: morning, date: '2026-11-04' }] });
    expect(again.body.rows).toEqual([{ userId: w1, shiftId: morning, date: '2026-11-04' }]);
    const audit = await ownerQuery<{ action: string; after: { rowCount: number } }>(
      "select action, after from audit_log where entity_id = $1 and action like 'roster.%' order by occurred_at, id",
      [w.siteId],
    );
    expect(audit.rows.map((r) => [r.action, r.after.rowCount])).toEqual([['roster.replaced', 3], ['roster.replaced', 1]]);
  });

  it('rejects users not at the site, inactive or foreign shifts, and long ranges', async () => {
    const { w, morning, night } = await world();
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const base = { siteId: w.siteId, from: '2026-11-02', to: '2026-11-08' };
    const notAtSite = await w.api.put('/api/v1/roster', { ...base, rows: [{ userId: outsider.id, shiftId: morning, date: '2026-11-02' }] });
    expect(notAtSite.body.error).toMatchObject({ code: 'ROSTER_USER_NOT_AT_SITE', userIds: [outsider.id] });
    const foreignShift = await w.api.put('/api/v1/roster', { ...base, rows: [{ userId: w.workers[0], shiftId: night, date: '2026-11-02' }] });
    expect(foreignShift.body.error.code).toBe('SHIFT_NOT_AT_SITE');
    await w.api.patch(`/api/v1/shifts/${morning}`, { active: false });
    const inactive = await w.api.put('/api/v1/roster', { ...base, rows: [{ userId: w.workers[0], shiftId: morning, date: '2026-11-02' }] });
    expect(inactive.body.error.code).toBe('SHIFT_INACTIVE');
    const long = await w.api.get(`/api/v1/roster?siteId=${w.siteId}&from=2026-11-01&to=2027-01-02`);
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toEqual({ to: 'scheduling.issues.rangeTooLong' });
  });

  it('copies a week into later weeks and emits roster.changed per target', async () => {
    const { w, morning } = await world();
    const [w0, w1] = w.workers as [string, string];
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: '2026-11-02',
      to: '2026-11-08',
      rows: [
        { userId: w0, shiftId: morning, date: '2026-11-02' },
        { userId: w1, shiftId: morning, date: '2026-11-06' },
      ],
    });
    // A stale row in a target week is replaced.
    await w.api.put('/api/v1/roster', { siteId: w.siteId, from: '2026-11-16', to: '2026-11-22', rows: [{ userId: w1, shiftId: morning, date: '2026-11-17' }] });
    const changed: string[] = [];
    const off = t.app.get(DomainEvents).on('roster.changed', (e) => {
      if (e.siteId === w.siteId) changed.push(`${e.from}..${e.to}`);
    });
    try {
      const res = await w.api.post('/api/v1/roster/copy', { siteId: w.siteId, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-09', '2026-11-16'] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toEqual({ rowCount: 4 });
    } finally {
      off();
    }
    expect(changed).toEqual(['2026-11-09..2026-11-15', '2026-11-16..2026-11-22']);
    const rows = (await w.api.get(`/api/v1/roster?siteId=${w.siteId}&from=2026-11-09&to=2026-11-22`)).body.rows;
    expect(rows).toEqual([
      { userId: w0, shiftId: morning, date: '2026-11-09' },
      { userId: w1, shiftId: morning, date: '2026-11-13' },
      { userId: w0, shiftId: morning, date: '2026-11-16' },
      { userId: w1, shiftId: morning, date: '2026-11-20' },
    ]);
  });
});

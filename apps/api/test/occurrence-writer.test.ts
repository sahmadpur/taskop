import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { DbService } from '../src/db/db.service';
import { EligibilityService } from '../src/scheduling/eligibility.service';
import { OccurrenceWriter } from '../src/scheduling/occurrence-writer';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { pinnedVersionOf as versionOf, publishNextVersion } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';

describe('scheduling hooks for executions', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('pins the current version once and never changes it', async () => {
    const w = await schedulingWorld(t);
    const [first, second] = await occurrenceRows((await createAssignment(w)).id);
    const writer = t.app.get(OccurrenceWriter);
    const inTenant = <T>(fn: () => Promise<T>) => t.app.get(DbService).withTenant(w.s.tenantId, w.s.ownerId, fn);
    const v1 = (await ownerQuery<{ v: string }>('select current_version_id as v from checklists where id = $1', [w.checklistId])).rows[0]!.v;
    await inTenant(() => writer.pinVersions([first!.id]));
    expect(await versionOf(first!.id)).toBe(v1);
    expect(await versionOf(second!.id)).toBeNull();
    const v2 = await publishNextVersion(w.api, w.checklistId, sampleContent());
    await inTenant(() => writer.pinVersions([first!.id, second!.id]));
    expect(await versionOf(first!.id)).toBe(v1);
    expect(await versionOf(second!.id)).toBe(v2);
  });

  it('applies several transitions with one history row and one event each', async () => {
    const w = await schedulingWorld(t);
    const first = (await occurrenceRows((await createAssignment(w)).id))[0]!;
    const seen: string[] = [];
    const off = t.app.get(DomainEvents).on('occurrence.status_changed', (e) => {
      if (e.occurrenceId === first.id) seen.push(`${e.from}->${e.to}@${e.at.toISOString()}`);
    });
    try {
      await t.app.get(DbService).withTenant(w.s.tenantId, w.workers[0]!, () =>
        t.app.get(OccurrenceWriter).applyTransitions([
          { occurrenceId: first.id, from: 'pending', to: 'started', at: new Date('2026-11-02T04:05:00Z') },
          { occurrenceId: first.id, from: 'started', to: 'in_progress', at: new Date('2026-11-02T04:10:00Z'), reason: 'late_sync' },
        ]),
      );
    } finally {
      off();
    }
    expect(seen).toEqual(['pending->started@2026-11-02T04:05:00.000Z', 'started->in_progress@2026-11-02T04:10:00.000Z']);
    const occ = await ownerQuery<{ status: string; status_changed_at: Date }>('select status, status_changed_at from occurrences where id = $1', [first.id]);
    expect(occ.rows[0]).toEqual({ status: 'in_progress', status_changed_at: new Date('2026-11-02T04:10:00Z') });
    const history = await ownerQuery<{ to_status: string; actor_user_id: string; reason: string | null }>(
      'select to_status, actor_user_id, reason from occurrence_status_history where occurrence_id = $1 order by id',
      [first.id],
    );
    expect(history.rows.slice(1)).toEqual([
      { to_status: 'started', actor_user_id: w.workers[0], reason: null },
      { to_status: 'in_progress', actor_user_id: w.workers[0], reason: 'late_sync' },
    ]);
  });

  it('lets a missed occurrence start only when asked to, and never after it closed', async () => {
    const w = await schedulingWorld(t);
    const [first, second] = await occurrenceRows((await createAssignment(w)).id);
    await ownerQuery("update occurrences set status = 'missed' where id = $1", [first!.id]);
    await ownerQuery("update occurrences set status = 'cancelled' where id = $1", [second!.id]);
    const elig = t.app.get(EligibilityService);
    const w0 = w.workers[0]!;
    const check = (id: string, iso: string, allowMissed?: boolean) =>
      t.app.get(DbService).withTenant(w.s.tenantId, null, () => elig.canStart(id, w0, new Date(iso), allowMissed === undefined ? undefined : { allowMissed }));
    expect(await check(first!.id, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
    expect(await check(first!.id, '2026-11-02T04:30:00Z', true)).toEqual({ ok: true, late: false });
    expect(await check(first!.id, '2026-11-02T06:30:00Z', true)).toEqual({ ok: true, late: true });
    expect(await check(first!.id, '2026-11-02T07:00:00Z', true)).toEqual({ ok: false, reason: 'CLOSED' });
    expect(await check(second!.id, '2026-11-03T04:30:00Z', true)).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
  });
});

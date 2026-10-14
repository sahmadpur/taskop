import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, signupTenant } from './fixtures';
import { addDevice, deliveriesOf, fanOutAll, inboxOf } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { createTask, newTaskBody, taskWorld } from './task-fixtures';

const token = (n: number) => `ExponentPushToken[shared-${n}-${Math.random().toString(36).slice(2)}]`;

/** `count` inbox rows for one user, each from its own processed event, all at `at` (owner connection). */
async function seedInbox(tenantId: string, userId: string, count: number, at: string, title = 'Mesaj'): Promise<string[]> {
  const r = await ownerQuery<{ id: string }>(
    `with e as (
       insert into notification_events (id, tenant_id, type, payload, created_at, processed_at, outcome)
       select gen_random_uuid(), $1, 'manual', '{}'::jsonb, $3, $3, 'fanned_out' from generate_series(1, $2)
       returning id)
     insert into notifications (id, tenant_id, event_id, user_id, type, title, body, target_kind, created_at)
     select gen_random_uuid(), $1, e.id, $4, 'manual', $5, 'Mətn', 'none', $3 from e
     returning id`,
    [tenantId, count, at, userId, title],
  );
  return r.rows.map((x) => x.id);
}

const devicesOf = async (userId: string) =>
  (await ownerQuery<{ expo_token: string; platform: string; last_seen_at: Date; disabled: boolean }>(
    'select expo_token, platform, last_seen_at, disabled_at is not null as disabled from push_devices where user_id = $1 order by expo_token',
    [userId],
  )).rows;

describe('inbox, preferences and push devices', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('pages by (created_at, id) without repeating or skipping rows of the same instant', async () => {
    const w = await taskWorld(t);
    const me = w.workers[0];
    const same = await seedInbox(w.s.tenantId, me.id, 35, '2026-11-01T10:00:00Z');
    const [newest] = await seedInbox(w.s.tenantId, me.id, 1, '2026-11-02T10:00:00Z', 'Ən yeni');
    await seedInbox(w.s.tenantId, w.workers[1].id, 3, '2026-11-02T11:00:00Z');
    const first = await me.api.get('/api/v1/me/notifications');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(30);
    expect(first.body.items[0]).toEqual({
      id: newest, type: 'manual', title: 'Ən yeni', body: 'Mətn', targetKind: 'none', targetId: null, targetDate: null, createdAt: '2026-11-02T10:00:00.000Z', readAt: null,
    });
    const second = await me.api.get(`/api/v1/me/notifications?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(6);
    expect(second.body.nextCursor).toBeNull();
    const seen = [...first.body.items, ...second.body.items].map((n: { id: string }) => n.id);
    expect(new Set(seen).size).toBe(36);
    expect([...seen].sort()).toEqual([newest!, ...same].sort());
    expect((await me.api.get('/api/v1/me/notifications?limit=101')).status).toBe(400);
  });

  it('counts unread rows, marks one or all read, and only ever touches the caller’s rows', async () => {
    const w = await taskWorld(t);
    const me = w.workers[0];
    const [a, b, c] = await seedInbox(w.s.tenantId, me.id, 3, '2026-11-01T10:00:00Z');
    const [theirs] = await seedInbox(w.s.tenantId, w.workers[1].id, 1, '2026-11-01T10:00:00Z');
    expect((await me.api.get('/api/v1/me/notifications/unread-count')).body).toEqual({ count: 3 });
    expect((await me.api.get('/api/v1/me/sync')).body.unreadNotifications).toBe(3);
    clock.set('2026-11-02T05:00:00Z');
    expect((await me.api.post(`/api/v1/me/notifications/${a}/read`)).status).toBe(204);
    expect((await me.api.post(`/api/v1/me/notifications/${a}/read`)).status).toBe(204);
    expect((await ownerQuery<{ read_at: Date }>('select read_at from notifications where id = $1', [a])).rows[0]!.read_at).toEqual(new Date('2026-11-02T05:00:00Z'));
    expect((await me.api.post(`/api/v1/me/notifications/${theirs}/read`)).status).toBe(404);
    expect((await me.api.post('/api/v1/me/notifications/not-an-id/read')).status).toBe(404);
    expect((await me.api.get('/api/v1/me/notifications?unread=true')).body.items.map((n: { id: string }) => n.id).sort()).toEqual([b, c].sort());
    expect((await me.api.get('/api/v1/me/notifications?unread=false')).body.items).toHaveLength(3);
    expect((await me.api.post('/api/v1/me/notifications/read-all')).status).toBe(204);
    expect((await me.api.get('/api/v1/me/notifications/unread-count')).body).toEqual({ count: 0 });
    expect((await me.api.get('/api/v1/me/sync')).body.unreadNotifications).toBe(0);
    expect((await w.workers[1].api.get('/api/v1/me/notifications/unread-count')).body).toEqual({ count: 1 });
  });

  it('switches email notifications for the caller only, and reports them on GET /me', async () => {
    const w = await taskWorld(t);
    expect((await w.manager.api.get('/api/v1/me')).body.user.emailNotifications).toBe(true);
    const res = await w.manager.api.patch('/api/v1/me/preferences', { emailNotifications: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emailNotifications: false });
    expect((await w.manager.api.get('/api/v1/me')).body.user.emailNotifications).toBe(false);
    expect((await w.owner.get('/api/v1/me')).body.user.emailNotifications).toBe(true);
    // A worker without an email address can still set it; it has no effect.
    expect((await w.workers[0].api.patch('/api/v1/me/preferences', { emailNotifications: false })).body).toEqual({ emailNotifications: false });
    expect((await w.workers[0].api.patch('/api/v1/me/preferences', {})).status).toBe(400);
  });

  it('registers a device idempotently, re-enables it, and removes it', async () => {
    const w = await taskWorld(t);
    const me = w.workers[0];
    const tok = token(1);
    expect((await me.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    await ownerQuery('update push_devices set disabled_at = now() where expo_token = $1', [tok]);
    clock.set('2026-11-02T06:00:00Z');
    expect((await me.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'ios' })).status).toBe(204);
    expect(await devicesOf(me.id)).toEqual([{ expo_token: tok, platform: 'ios', last_seen_at: new Date('2026-11-02T06:00:00Z'), disabled: false }]);
    expect((await me.api.put('/api/v1/me/push-devices', { expoToken: 'not-a-token', platform: 'ios' })).status).toBe(400);
    expect((await me.api.delete(`/api/v1/me/push-devices/${encodeURIComponent(tok)}`)).status).toBe(204);
    expect(await devicesOf(me.id)).toEqual([]);
    expect((await me.api.delete(`/api/v1/me/push-devices/${encodeURIComponent(tok)}`)).status).toBe(204);
  });

  it('claims a token from another user of the tenant and from another tenant', async () => {
    const w = await taskWorld(t);
    const [first, second] = w.workers;
    const tok = token(2);
    expect((await first.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    // The same phone, now signed in as İşçi 2 (İşçi 1's logout call failed).
    expect((await second.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    expect(await devicesOf(first.id)).toEqual([]);
    expect((await devicesOf(second.id)).map((d) => d.expo_token)).toEqual([tok]);
    // İşçi 1's own deletion no longer touches the phone that İşçi 2 now holds.
    expect((await first.api.delete(`/api/v1/me/push-devices/${encodeURIComponent(tok)}`)).status).toBe(204);
    expect((await devicesOf(second.id)).map((d) => d.expo_token)).toEqual([tok]);
    // Then someone of another organisation signs in on it.
    const other = await signupTenant(t);
    expect((await as(t, other.accessToken).put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    expect(await devicesOf(second.id)).toEqual([]);
    expect((await devicesOf(other.ownerId)).map((d) => d.expo_token)).toEqual([tok]);
    // Both former holders still get their inbox rows, but neither gets a push to the phone they no longer hold.
    await createTask(w.manager.api, newTaskBody({ userId: first.id }));
    await createTask(w.manager.api, newTaskBody({ userId: second.id }));
    await fanOutAll(t, w.s.tenantId);
    expect((await inboxOf(first.id)).map((n) => n.type)).toEqual(['task.assigned']);
    expect((await inboxOf(second.id)).map((n) => n.type)).toEqual(['task.assigned']);
    expect(await deliveriesOf(first.id)).toEqual([]);
    expect(await deliveriesOf(second.id)).toEqual([]);
  });

  it('disables a deactivated user’s devices', async () => {
    const w = await taskWorld(t);
    const phone = await addDevice(w.s.tenantId, w.workers[0].id);
    const other = await addDevice(w.s.tenantId, w.workers[1].id);
    expect((await w.owner.post(`/api/v1/users/${w.workers[0].id}/deactivate`)).status).toBe(200);
    const rows = await ownerQuery<{ id: string; disabled: boolean }>('select id, disabled_at is not null as disabled from push_devices where id = any($1) order by id', [[phone.id, other.id]]);
    expect(rows.rows).toEqual([{ id: phone.id, disabled: true }, { id: other.id, disabled: false }]);
  });

  it('needs a signed-in user', async () => {
    const s = await signupTenant(t);
    expect((await t.http().get('/api/v1/me/notifications')).status).toBe(401);
    expect((await as(t, s.accessToken).get('/api/v1/me/notifications')).body).toEqual({ items: [], nextCursor: null });
  });
});

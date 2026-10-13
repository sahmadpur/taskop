import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { roleIdOf, siteTypeIdOf } from './fixtures';
import { addDevice, deliverAll, eventRows, fanOutAll, inboxOf, pushSender, staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { taskWorld } from './task-fixtures';

const zero = { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 };
const message = (over: Record<string, unknown>) => ({ title: 'Diqqət', body: 'Sabah 09:00-da iclas var.', ...over });

describe('manual messages', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    pushSender(t).reset();
  });
  afterAll(() => t.close());

  /** taskWorld plus a team "Uzaq" with only İşçi 3 (Filial 2), outside the manager's Filial 1 scope. */
  async function world() {
    const w = await taskWorld(t);
    const far = await w.owner.post('/api/v1/teams', { name: 'Uzaq' });
    expect((await w.owner.put(`/api/v1/teams/${far.body.id}/members`, { userIds: [w.workers[2].id] })).status).toBe(200);
    return { ...w, farTeamId: far.body.id as string };
  }

  it('offers only users, teams and sites inside the sender’s scope', async () => {
    const w = await world();
    const res = await w.manager.api.get('/api/v1/notifications/messages/options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      users: [
        { id: w.workers[0].id, fullName: 'İşçi 1', jobTitle: null },
        { id: w.workers[1].id, fullName: 'İşçi 2', jobTitle: null },
      ],
      teams: [{ id: w.teamId, name: 'Texniki xidmət', memberCount: 2 }],
      sites: [{ id: w.siteId, name: 'Filial 1' }],
    });
    const filtered = await w.manager.api.get(`/api/v1/notifications/messages/options?q=${encodeURIComponent('çi 2')}`);
    expect(filtered.body.users.map((u: { id: string }) => u.id)).toEqual([w.workers[1].id]);
    expect(filtered.body.teams).toEqual([]);
    expect(filtered.body.sites).toEqual([{ id: w.siteId, name: 'Filial 1' }]);
    const all = (await w.owner.get('/api/v1/notifications/messages/options')).body;
    expect(all.users.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([w.workers[2].id, w.manager.id]));
    expect(all.users.map((u: { id: string }) => u.id)).not.toContain(w.s.ownerId);
    expect(all.teams.map((x: { name: string }) => x.name)).toEqual(['Texniki xidmət', 'Uzaq']);
  });

  it('previews the recipient count and refuses ids outside the scope', async () => {
    const w = await world();
    const preview = (body: Record<string, unknown>) => w.manager.api.post('/api/v1/notifications/messages/preview', message(body));
    expect((await preview({ teamIds: [w.teamId] })).body).toEqual({ recipientCount: 2 });
    expect((await preview({ siteIds: [w.siteId], userIds: [w.workers[0].id] })).body).toEqual({ recipientCount: 2 });
    for (const body of [{ userIds: [w.workers[2].id] }, { teamIds: [w.farTeamId] }, { siteIds: [w.otherSiteId] }]) {
      const res = await preview(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const none = await preview({});
    expect(none.status).toBe(400);
    expect(none.body.error.fields).toEqual({ userIds: 'notifications.issues.noTargets' });
  });

  it('sends: records a manual event by the sender, audits it, and answers with an unprocessed summary', async () => {
    const w = await world();
    const res = await w.manager.api.post('/api/v1/notifications/messages', message({ teamIds: [w.teamId], email: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [event] = await eventRows(w.s.tenantId, 'manual');
    expect(res.body).toEqual({
      id: event!.id, title: 'Diqqət', body: 'Sabah 09:00-da iclas var.', sender: { id: w.manager.id, fullName: 'Menecer' }, sentAt: '2026-11-02T04:00:00.000Z',
      emailRequested: true, processed: false, recipientCount: 0, readCount: 0, push: zero, email: zero,
    });
    expect(event).toMatchObject({ actor_user_id: w.manager.id, payload: { title: 'Diqqət', body: 'Sabah 09:00-da iclas var.', userIds: [], teamIds: [w.teamId], siteIds: [], email: true } });
    const audit = await ownerQuery<{ action: string; entity_type: string; entity_id: string; actor_user_id: string; after: { recipientCount: number } }>(
      "select action, entity_type, entity_id, actor_user_id, after from audit_log where tenant_id = $1 and action = 'notification.message_sent'",
      [w.s.tenantId],
    );
    expect(audit.rows).toEqual([{ action: 'notification.message_sent', entity_type: 'notification_message', entity_id: event!.id, actor_user_id: w.manager.id, after: expect.objectContaining({ recipientCount: 2 }) }]);
    await fanOutAll(t, w.s.tenantId);
    expect((await inboxOf(w.workers[0].id)).map((n) => [n.type, n.title])).toEqual([['manual', 'Diqqət']]);
    expect(await inboxOf(w.manager.id)).toEqual([]);
  });

  it('refuses a send that reaches nobody or more than 1000 people', async () => {
    const w = await world();
    const typeId = await siteTypeIdOf(w.s.tenantId);
    const empty = (await w.owner.post('/api/v1/sites', { parentId: w.siteId, typeId, name: 'Boş anbar' })).body.id as string;
    expect((await w.manager.api.post('/api/v1/notifications/messages/preview', message({ siteIds: [empty] }))).body).toEqual({ recipientCount: 0 });
    const nobody = await w.manager.api.post('/api/v1/notifications/messages', message({ siteIds: [empty] }));
    expect(nobody.status).toBe(400);
    expect(nobody.body.error.fields).toEqual({ userIds: 'notifications.issues.noRecipients' });
    const big = (await w.owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Böyük filial' })).body.id as string;
    const suffix = randomBytes(4).toString('hex');
    await ownerQuery(
      `with u as (
         insert into users (id, tenant_id, full_name, role_id, kind, username, status)
         select gen_random_uuid(), $1, 'Toplu ' || g, $2, 'worker', 'bulk-' || g || '-' || $4, 'active' from generate_series(1, 1001) g
         returning id)
       insert into user_sites (tenant_id, user_id, site_id) select $1, u.id, $3 from u`,
      [w.s.tenantId, await roleIdOf(w.s.tenantId, 'worker'), big, suffix],
    );
    expect((await w.owner.post('/api/v1/notifications/messages/preview', message({ siteIds: [big] }))).body).toEqual({ recipientCount: 1001 });
    const tooMany = await w.owner.post('/api/v1/notifications/messages', message({ siteIds: [big] }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.fields).toEqual({ userIds: 'notifications.issues.tooManyRecipients' });
    expect(await eventRows(w.s.tenantId, 'manual')).toEqual([]);
  });

  it('lists a sender’s own messages, every message for notifications.manage, with per-recipient counts', async () => {
    const w = await world();
    await addDevice(w.s.tenantId, w.workers[0].id);
    const mine = (await w.manager.api.post('/api/v1/notifications/messages', message({ teamIds: [w.teamId] }))).body.id as string;
    clock.set('2026-11-02T04:05:00Z');
    const owners = (await w.owner.post('/api/v1/notifications/messages', message({ title: 'Hamıya', userIds: [w.workers[2].id] }))).body.id as string;
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    expect((await w.workers[1].api.post(`/api/v1/me/notifications/${(await inboxOf(w.workers[1].id))[0]!.id}/read`)).status).toBe(204);
    const managerList = await w.manager.api.get('/api/v1/notifications/messages');
    expect(managerList.body.items.map((m: { id: string }) => m.id)).toEqual([mine]);
    expect(managerList.body.items[0]).toMatchObject({ processed: true, recipientCount: 2, readCount: 1, push: { ...zero, sent: 1 }, email: zero });
    const ownerList = await w.owner.get('/api/v1/notifications/messages?limit=1');
    expect(ownerList.body.items.map((m: { id: string }) => m.id)).toEqual([owners]);
    const next = await w.owner.get(`/api/v1/notifications/messages?limit=1&cursor=${ownerList.body.nextCursor}`);
    expect(next.body).toMatchObject({ items: [expect.objectContaining({ id: mine })], nextCursor: null });
    expect((await w.manager.api.get(`/api/v1/notifications/messages/${owners}`)).status).toBe(404);
    expect((await w.owner.get(`/api/v1/notifications/messages/${mine}`)).status).toBe(200);
    expect((await w.workers[0].api.get('/api/v1/notifications/messages')).status).toBe(403);
    expect((await w.workers[0].api.get('/api/v1/notifications/messages/options')).status).toBe(403);
    expect((await w.workers[0].api.post('/api/v1/notifications/messages', message({ userIds: [w.workers[1].id] }))).status).toBe(403);
  });

  it('details each recipient’s read state and per-channel status with the last error', async () => {
    const w = await world();
    const phone = await addDevice(w.s.tenantId, w.workers[0].id);
    const admin = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    pushSender(t).ticketFor = (m) => (m.to === phone.token ? { ok: false, error: 'DeviceNotRegistered', message: 'gone' } : { ok: true, id: 'x' });
    const id = (await admin.api.post('/api/v1/notifications/messages', message({ teamIds: [w.teamId], userIds: [w.manager.id], siteIds: [w.siteId], email: true }))).body.id as string;
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    const res = await admin.api.get(`/api/v1/notifications/messages/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.targets).toEqual({
      users: [{ id: w.manager.id, fullName: 'Menecer' }],
      teams: [{ id: w.teamId, name: 'Texniki xidmət' }],
      sites: [{ id: w.siteId, name: 'Filial 1' }],
    });
    // Ordered by full name in the database collation; compare as a set so the test does not depend on how "İ" sorts.
    expect(res.body.recipients).toHaveLength(3);
    expect(res.body.recipients).toEqual(expect.arrayContaining([
      { user: { id: w.workers[0].id, fullName: 'İşçi 1' }, readAt: null, push: { status: 'failed', devices: 1, lastError: 'DeviceNotRegistered: gone' }, email: { status: null, lastError: null } },
      { user: { id: w.workers[1].id, fullName: 'İşçi 2' }, readAt: null, push: { status: null, devices: 0, lastError: null }, email: { status: null, lastError: null } },
      { user: { id: w.manager.id, fullName: 'Menecer' }, readAt: null, push: { status: null, devices: 0, lastError: null }, email: { status: 'sent', lastError: null } },
    ]));
    expect(res.body).toMatchObject({ recipientCount: 3, push: { ...zero, failed: 1 }, email: { ...zero, sent: 1 } });
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { createUserDirect, signupTenant } from './fixtures';
import { addDevice, asApp } from './notification-fixtures';
import { ownerQuery } from './owner-db';

const TABLES = ['notification_events', 'notifications', 'notification_deliveries', 'push_devices', 'notification_rules'];

const insertEvent = async (tenantId: string, dedupeKey: string | null = null) => {
  const id = uuidv7();
  await ownerQuery("insert into notification_events (id, tenant_id, type, payload, dedupe_key) values ($1, $2, 'task.assigned', '{}'::jsonb, $3)", [id, tenantId, dedupeKey]);
  return id;
};
const insertNotification = async (tenantId: string, eventId: string, userId: string) => {
  const id = uuidv7();
  await ownerQuery(
    "insert into notifications (id, tenant_id, event_id, user_id, type, title, body, target_kind) values ($1, $2, $3, $4, 'task.assigned', 'Yeni tapşırıq', 'Qapı', 'none')",
    [id, tenantId, eventId, userId],
  );
  return id;
};

describe('notification tables', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('forces row level security on every new table', async () => {
    const r = await ownerQuery<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname',
      [TABLES],
    );
    expect(r.rows).toHaveLength(TABLES.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('hides another tenant’s rows from the app role, and lets it delete its own', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const eventId = await insertEvent(a.tenantId);
    await insertNotification(a.tenantId, eventId, a.ownerId);
    await addDevice(a.tenantId, a.ownerId);
    for (const table of TABLES) {
      expect((await asApp(b.tenantId, (c) => c.query(`select 1 from ${table}`))).rowCount, table).toBe(0);
    }
    expect((await asApp(a.tenantId, (c) => c.query('select 1 from notifications'))).rowCount).toBe(1);
    expect((await asApp(a.tenantId, (c) => c.query('delete from push_devices'))).rowCount).toBe(1);
  });

  it('dedupes events per tenant on dedupe_key and allows any number without one', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    await insertEvent(a.tenantId, 'checklist.overdue:x');
    await expect(insertEvent(a.tenantId, 'checklist.overdue:x')).rejects.toThrow(/notification_events_dedupe_uq/);
    await insertEvent(b.tenantId, 'checklist.overdue:x');
    await insertEvent(a.tenantId);
    await insertEvent(a.tenantId);
  });

  it('keeps one inbox row per user and event, and deletes notifications and deliveries with their event', async () => {
    const a = await signupTenant(t);
    const eventId = await insertEvent(a.tenantId);
    const n = await insertNotification(a.tenantId, eventId, a.ownerId);
    await expect(insertNotification(a.tenantId, eventId, a.ownerId)).rejects.toThrow(/notifications_event_user_uq/);
    await ownerQuery("insert into notification_deliveries (id, tenant_id, notification_id, channel) values ($1, $2, $3, 'email')", [uuidv7(), a.tenantId, n]);
    await ownerQuery('delete from notification_events where id = $1', [eventId]);
    expect((await ownerQuery('select 1 from notifications where id = $1', [n])).rowCount).toBe(0);
    expect((await ownerQuery('select 1 from notification_deliveries where notification_id = $1', [n])).rowCount).toBe(0);
  });

  it('gives deliveries a nullable claimed_at that starts empty', async () => {
    const a = await signupTenant(t);
    const n = await insertNotification(a.tenantId, await insertEvent(a.tenantId), a.ownerId);
    const col = await ownerQuery<{ is_nullable: string; column_default: string | null }>(
      "select is_nullable, column_default from information_schema.columns where table_name = 'notification_deliveries' and column_name = 'claimed_at'",
    );
    expect(col.rows).toEqual([{ is_nullable: 'YES', column_default: null }]);
    const id = uuidv7();
    await ownerQuery("insert into notification_deliveries (id, tenant_id, notification_id, channel) values ($1, $2, $3, 'email')", [id, a.tenantId, n]);
    expect((await ownerQuery<{ c: Date | null }>('select claimed_at as c from notification_deliveries where id = $1', [id])).rows[0]!.c).toBeNull();
  });

  it('keeps an Expo token unique across tenants', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { token } = await addDevice(a.tenantId, a.ownerId);
    await expect(addDevice(b.tenantId, b.ownerId, token)).rejects.toThrow(/push_devices_token_uq/);
  });

  it('allows only the four lead times and defaults email notifications to on', async () => {
    const a = await signupTenant(t);
    const rule = (type: string, lead: number | null) =>
      ownerQuery(
        'insert into notification_rules (tenant_id, type, enabled, push, email, notify_assignees, notify_creator, lead_minutes) values ($1, $2, true, true, false, true, false, $3)',
        [a.tenantId, type, lead],
      );
    await rule('checklist.due_soon', 60);
    await expect(rule('checklist.available', 45)).rejects.toThrow(/notification_rules_lead_ck/);
    await rule('checklist.available', null);
    const w = await createUserDirect(t, a.tenantId);
    expect((await ownerQuery<{ e: boolean }>('select email_notifications as e from users where id = $1', [w.id])).rows[0]!.e).toBe(true);
  });

  it('backfills the notification keys for existing Admin and Manager roles', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) => (await ownerQuery<{ id: string }>('select id from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!.id;
    const roles = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key like 'notifications.%'", [Object.values(roles)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0012_notifications_security.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim());
    const start = stmts.findIndex((x) => /row_security\s*=\s*off/i.test(x));
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts.slice(start)) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = async (roleId: string) =>
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key like 'notifications.%' order by 1", [roleId])).rows.map((r) => r.k);
    expect(await keys(roles.admin)).toEqual(['notifications.manage', 'notifications.send']);
    expect(await keys(roles.manager)).toEqual(['notifications.send']);
    expect(await keys(roles.auditor)).toEqual([]);
    expect(await keys(roles.worker)).toEqual([]);
  });
});

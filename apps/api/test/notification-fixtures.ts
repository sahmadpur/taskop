import { randomUUID } from 'node:crypto';
import type { SystemRoleKey } from '@taskop/contracts';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { inject } from 'vitest';
import type { TestApp } from './app';
import { as, createUserDirect, loginStaff } from './fixtures';
import { ownerQuery } from './owner-db';
import type { Api } from './scheduling-fixtures';

/** An Android device row straight in the DB (owner connection). */
export async function addDevice(tenantId: string, userId: string, token = `ExponentPushToken[${randomUUID()}]`): Promise<{ id: string; token: string }> {
  const id = uuidv7();
  await ownerQuery(
    `insert into push_devices (id, tenant_id, user_id, expo_token, platform, last_seen_at) values ($1, $2, $3, $4, 'android', now())`,
    [id, tenantId, userId, token],
  );
  return { id, token };
}

export interface EventRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor_user_id: string | null;
  dedupe_key: string | null;
  created_at: Date;
  processed_at: Date | null;
  outcome: string | null;
  attempts: number;
  last_error: string | null;
}

/** The tenant's notification events, oldest first (owner connection). */
export async function eventRows(tenantId: string, type?: string): Promise<EventRow[]> {
  const r = await ownerQuery<EventRow>(
    `select * from notification_events where tenant_id = $1 ${type ? 'and type = $2' : ''} order by created_at, id`,
    type ? [tenantId, type] : [tenantId],
  );
  return r.rows;
}

/** A taskop_app transaction with RLS set to `tenantId`; always rolled back. */
export async function asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: inject('db').appUrl, max: 1 });
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
    await pool.end();
  }
}

/** A staff user with a built-in role, linked to `siteIds`, logged in on the web. */
export async function staffAt(t: TestApp, tenantId: string, owner: Api, roleKey: SystemRoleKey, siteIds: string[], fullName = `Staff ${roleKey}`) {
  const u = await createUserDirect(t, tenantId, { kind: 'staff', roleKey, fullName, emailVerified: true });
  if (siteIds.length) {
    const res = await owner.put(`/api/v1/users/${u.id}/sites`, { siteIds });
    if (res.status !== 200) throw new Error(`linking sites failed: ${JSON.stringify(res.body)}`);
  }
  const login = await loginStaff(t, u.email!, u.secret, 'web');
  return { id: u.id, email: u.email!, api: as(t, login.accessToken) };
}

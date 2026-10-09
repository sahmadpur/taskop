import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

const TABLES = ['shifts', 'shift_roster', 'assignments', 'assignment_assignees', 'occurrences', 'occurrence_assignees', 'occurrence_status_history'];
const NEW_ADMIN_KEYS = ['assignments.view', 'assignments.manage', 'assignments.extended_window', 'shifts.view', 'shifts.manage'];

async function asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** A raw assignment with one occurrence, inserted as the owner (no API yet). */
async function seedOccurrence(tenantId: string, ownerId: string) {
  const typeId = await siteTypeIdOf(tenantId);
  const site = await ownerQuery<{ id: string }>(
    "insert into sites (id, tenant_id, type_id, name, path) values (gen_random_uuid(), $1, $2, 'S', 'x') returning id",
    [tenantId, typeId],
  );
  const checklist = await ownerQuery<{ id: string }>(
    "insert into checklists (id, tenant_id, name, created_by_user_id) values (gen_random_uuid(), $1, 'C', $2) returning id",
    [tenantId, ownerId],
  );
  const assignment = await ownerQuery<{ id: string }>(
    `insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, created_by_user_id)
     values (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, '{}'::jsonb, $4) returning id`,
    [tenantId, checklist.rows[0]!.id, site.rows[0]!.id, ownerId],
  );
  const occ = (status: string) =>
    ownerQuery<{ id: string }>(
      `insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status)
       values (gen_random_uuid(), $1, $2, $3, $4, '2026-11-02', '2026-11-02T04:00Z', '2026-11-02T06:00Z', '2026-11-02T07:00Z', $5) returning id`,
      [tenantId, assignment.rows[0]!.id, checklist.rows[0]!.id, site.rows[0]!.id, status],
    );
  return { assignmentId: assignment.rows[0]!.id, occ };
}

describe('scheduling tables', () => {
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

  it('hides another tenant’s occurrences from the app account', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { occ } = await seedOccurrence(a.tenantId, a.ownerId);
    await occ('pending');
    expect((await asApp(b.tenantId, (c) => c.query('select id from occurrences'))).rowCount).toBe(0);
    expect((await asApp(a.tenantId, (c) => c.query('select id from occurrences'))).rowCount).toBe(1);
  });

  it('allows one live occurrence per assignment and day, ignoring cancelled ones', async () => {
    const s = await signupTenant(t);
    const { occ } = await seedOccurrence(s.tenantId, s.ownerId);
    await occ('cancelled');
    await occ('pending');
    await expect(occ('pending')).rejects.toThrow(/occurrences_live_day_uq/);
  });

  it('keeps the status history append-only for the app account', async () => {
    const s = await signupTenant(t);
    const { occ } = await seedOccurrence(s.tenantId, s.ownerId);
    const id = (await occ('pending')).rows[0]!.id;
    await asApp(s.tenantId, async (c) => {
      await c.query("insert into occurrence_status_history (id, tenant_id, occurrence_id, to_status, at) values (gen_random_uuid(), $1, $2, 'pending', now())", [s.tenantId, id]);
      await c.query('savepoint sp');
      await expect(c.query("update occurrence_status_history set reason = 'x'")).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint sp');
      await expect(c.query('delete from occurrence_status_history')).rejects.toThrow(/permission denied/);
    });
  });

  it('gives the app account its own pgboss schema', async () => {
    const r = await ownerQuery<{ owner: string }>("select nspowner::regrole::text as owner from pg_namespace where nspname = 'pgboss'");
    expect(r.rows[0]?.owner).toBe('taskop_app');
  });

  it('backfills the new keys for existing Admin roles', async () => {
    const s = await signupTenant(t);
    const adminRole = (await ownerQuery<{ id: string }>("select id from roles where tenant_id = $1 and system_key = 'admin'", [s.tenantId])).rows[0]!.id;
    await ownerQuery('delete from role_permissions where role_id = $1 and permission_key = any($2)', [adminRole, NEW_ADMIN_KEYS]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0006_scheduling_security.sql'), 'utf8');
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
    const keys = await ownerQuery<{ permission_key: string }>('select permission_key from role_permissions where role_id = $1', [adminRole]);
    expect(keys.rows.map((r) => r.permission_key)).toEqual(expect.arrayContaining(NEW_ADMIN_KEYS));
  });
});

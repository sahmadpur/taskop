import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestApp, type TestApp } from './app';
import { signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

const TABLES = ['executions', 'execution_media', 'execution_problems'];

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

/** A raw site, published version, assignment and occurrence (no API), so the execution tables can be exercised alone. */
async function seedOccurrence(tenantId: string, ownerId: string) {
  const typeId = await siteTypeIdOf(tenantId);
  const one = async (text: string, params: unknown[]) => (await ownerQuery<{ id: string }>(text, params)).rows[0]!.id;
  const siteId = await one("insert into sites (id, tenant_id, type_id, name, path) values (gen_random_uuid(), $1, $2, 'S', 'x') returning id", [tenantId, typeId]);
  const checklistId = await one("insert into checklists (id, tenant_id, name, created_by_user_id) values (gen_random_uuid(), $1, 'C', $2) returning id", [tenantId, ownerId]);
  const versionId = await one(
    `insert into checklist_versions (id, tenant_id, checklist_id, state, number, content, created_by_user_id, published_by_user_id, published_at)
     values (gen_random_uuid(), $1, $2, 'published', 1, '{}'::jsonb, $3, $3, now()) returning id`,
    [tenantId, checklistId, ownerId],
  );
  const assignmentId = await one(
    `insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, created_by_user_id)
     values (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, '{}'::jsonb, $4) returning id`,
    [tenantId, checklistId, siteId, ownerId],
  );
  const occurrenceId = await one(
    `insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, checklist_version_id)
     values (gen_random_uuid(), $1, $2, $3, $4, '2026-11-02', '2026-11-02T04:00Z', '2026-11-02T06:00Z', '2026-11-02T07:00Z', $5) returning id`,
    [tenantId, assignmentId, checklistId, siteId, versionId],
  );
  const execution = (state: string, reason: string | null = null) =>
    ownerQuery<{ id: string }>(
      `insert into executions (id, tenant_id, occurrence_id, checklist_version_id, executor_user_id, state, rejected_reason,
                               started_at, started_received_at, last_synced_at, progress, device)
       values ($1, $2, $3, $4, $5, $6, $7, now(), now(), now(), '{"answered":0,"total":1,"requiredMissing":1}', '{"platform":"ios","osVersion":"26","appVersion":"1"}')
       returning id`,
      [uuidv7(), tenantId, occurrenceId, versionId, ownerId, state, reason],
    );
  return { siteId, checklistId, occurrenceId, execution };
}

describe('execution tables', () => {
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

  it('allows one counted execution per occurrence but any number of rejected ones', async () => {
    const s = await signupTenant(t);
    const { execution } = await seedOccurrence(s.tenantId, s.ownerId);
    await execution('active');
    await execution('rejected', 'ALREADY_CLAIMED');
    await execution('rejected', 'NOT_ON_SHIFT');
    await expect(execution('completed')).rejects.toThrow(/executions_claim_uq/);
  });

  it('requires a reason exactly when rejected', async () => {
    const s = await signupTenant(t);
    const { execution } = await seedOccurrence(s.tenantId, s.ownerId);
    await expect(execution('rejected')).rejects.toThrow(/executions_rejected_ck/);
    await expect(execution('active', 'CLOSED')).rejects.toThrow(/executions_rejected_ck/);
  });

  it('hides another tenant’s executions and lets the app account delete only problems', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { execution, occurrenceId, siteId, checklistId } = await seedOccurrence(a.tenantId, a.ownerId);
    const executionId = (await execution('active')).rows[0]!.id;
    await ownerQuery(
      `insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity, media_ids)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, gen_random_uuid(), 'manual', 'critical', '{}')`,
      [a.tenantId, executionId, occurrenceId, siteId, checklistId],
    );
    expect((await asApp(b.tenantId, (c) => c.query('select id from executions'))).rowCount).toBe(0);
    await asApp(a.tenantId, async (c) => {
      expect((await c.query('select id from executions')).rowCount).toBe(1);
      expect((await c.query('delete from execution_problems')).rowCount).toBe(1);
      await c.query('savepoint sp');
      await expect(c.query('delete from executions')).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint sp');
      await expect(c.query('delete from execution_media')).rejects.toThrow(/permission denied/);
    });
  });

  it('pins occurrences only to versions of the same tenant', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { occurrenceId } = await seedOccurrence(a.tenantId, a.ownerId);
    const foreign = await seedOccurrence(b.tenantId, b.ownerId);
    const foreignVersion = (await ownerQuery<{ v: string }>('select checklist_version_id as v from occurrences where id = $1', [foreign.occurrenceId])).rows[0]!.v;
    await expect(ownerQuery('update occurrences set checklist_version_id = $1 where id = $2', [foreignVersion, occurrenceId])).rejects.toThrow(/occurrences_version_fk/);
  });
});

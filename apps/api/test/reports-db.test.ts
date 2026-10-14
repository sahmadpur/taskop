import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('report index and permissions', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('indexes occurrences by tenant and local day, and relies on the existing execution indexes', async () => {
    const r = await ownerQuery<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where indexname in ('occurrences_local_date_idx', 'executions_occurrence_idx', 'executions_claim_uq') order by indexname`,
    );
    expect(r.rows.map((x) => x.indexname)).toEqual(['executions_claim_uq', 'executions_occurrence_idx', 'occurrences_local_date_idx']);
    expect(r.rows.find((x) => x.indexname === 'occurrences_local_date_idx')!.indexdef).toContain('(tenant_id, local_date)');
    expect(r.rows.find((x) => x.indexname === 'executions_claim_uq')!.indexdef).toContain("WHERE (state <> 'rejected'::execution_state)");
  });

  it('backfills the report keys for existing Admin, Manager and Auditor roles and bumps their version', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) =>
      (await ownerQuery<{ id: string; version: number }>('select id, version from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!;
    const before = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key like 'reports.%'", [Object.values(before).map((r) => r.id)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0014_reports_permissions.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = async (roleId: string) =>
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key like 'reports.%' order by 1", [roleId])).rows.map((r) => r.k);
    for (const key of ['admin', 'manager', 'auditor'] as const) {
      expect(await keys(before[key].id), key).toEqual(['reports.export', 'reports.view']);
      expect((await roleOf(key)).version, key).toBe(before[key].version + 1);
    }
    expect(await keys(before.worker.id)).toEqual([]);
    expect((await roleOf('worker')).version).toBe(before.worker.version);
  });
});

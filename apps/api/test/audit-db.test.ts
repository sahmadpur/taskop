import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { signupTenant } from './fixtures';
import { asApp } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems } from './task-fixtures';

const TABLES = ['execution_corrections', 'execution_rework_requests', 'audits', 'audit_item_verdicts'];

describe('audit and correction tables (SP8 spec §4)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  afterAll(() => t.close());

  const run = () => closedRunWithProblems(t, clock);
  const correctionRow = (tenantId: string, executionId: string, actor: string) =>
    ownerQuery<{ id: string }>(
      `insert into execution_corrections (id, tenant_id, execution_id, item_id, kind, round, before, after, reason, actor_user_id, at)
       values ($1, $2, $3, gen_random_uuid(), 'manual', 0, '{"number":10}', '{"number":5}', 'Səhv', $4, now()) returning id`,
      [uuidv7(), tenantId, executionId, actor],
    );
  const auditRow = (tenantId: string, executionId: string, occurrenceId: string, auditor: string, status = 'in_progress') =>
    ownerQuery<{ id: string }>(
      `insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at, cancelled_at, cancel_reason)
       values ($1, $2, $3, $4, $5::audit_status, $6, now(), case when $5::text = 'cancelled' then now() end, case when $5::text = 'cancelled' then 'x' end) returning id`,
      [uuidv7(), tenantId, executionId, occurrenceId, status, auditor],
    );

  it('adds the two enum values and forces row level security on every new table', async () => {
    const values = await ownerQuery<{ v: string }>("select unnest(enum_range(null::occurrence_status))::text as v");
    expect(values.rows.map((r) => r.v).at(-1)).toBe('correction_required');
    const states = await ownerQuery<{ v: string }>("select unnest(enum_range(null::execution_state))::text as v");
    expect(states.rows.map((r) => r.v).at(-1)).toBe('rework');
    const r = await ownerQuery<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname',
      [TABLES],
    );
    expect(r.rows).toHaveLength(TABLES.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('writes the original answers once and refuses to change them afterwards', async () => {
    const { executionId } = await run();
    await ownerQuery(
      `update executions set original_answers = answers, original_score = score, original_captured_at = now() where id = $1`,
      [executionId],
    );
    await expect(ownerQuery(`update executions set original_answers = '{}'::jsonb where id = $1`, [executionId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery(`update executions set original_score = null where id = $1`, [executionId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery(`update executions set original_captured_at = now() + interval '1 day' where id = $1`, [executionId])).rejects.toThrow(/immutable/);
    // Everything else still updates.
    expect((await ownerQuery(`update executions set rework_round = rework_round + 1 where id = $1`, [executionId])).rowCount).toBe(1);
  });

  it('keeps corrections append-only and lets the app update only the closing columns of a rework request', async () => {
    const { w, executionId } = await run();
    await correctionRow(w.s.tenantId, executionId, w.s.ownerId);
    await ownerQuery(
      `insert into execution_rework_requests (id, tenant_id, execution_id, round, items, requested_by_user_id, requested_at, answers_before, status_before)
       values ($1, $2, $3, 1, '[]', $4, now(), '{}', 'completed')`,
      [uuidv7(), w.s.tenantId, executionId, w.s.ownerId],
    );
    await asApp(w.s.tenantId, async (c) => {
      expect((await c.query('select id from execution_corrections')).rowCount).toBe(1);
      for (const stmt of ["update execution_corrections set reason = 'x'", 'delete from execution_corrections', "update execution_rework_requests set items = '[]'", 'delete from execution_rework_requests', 'delete from audits']) {
        await c.query('savepoint sp');
        await expect(c.query(stmt), stmt).rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint sp');
      }
      expect((await c.query('update execution_rework_requests set withdrawn_at = now(), withdrawn_by_user_id = null')).rowCount).toBe(1);
    });
  });

  it('hides another tenant’s rows', async () => {
    const { w, executionId } = await run();
    const other = await signupTenant(t);
    await correctionRow(w.s.tenantId, executionId, w.s.ownerId);
    await auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId);
    for (const table of ['execution_corrections', 'audits']) {
      expect((await asApp(other.tenantId, (c) => c.query(`select 1 from ${table}`))).rowCount, table).toBe(0);
      expect((await asApp(w.s.tenantId, (c) => c.query(`select 1 from ${table}`))).rowCount, table).toBe(1);
    }
  });

  it('allows a cleared problem and a new active one on the same item, but never two active ones', async () => {
    const { w, executionId, ruleProblemId } = await run();
    const insertRule = () =>
      ownerQuery(
        `insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity)
         select gen_random_uuid(), tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, 'rule', 'normal' from execution_problems where id = $1`,
        [ruleProblemId],
      );
    await expect(insertRule()).rejects.toThrow(/execution_problems_active_item_uq/);
    const correctionId = (await correctionRow(w.s.tenantId, executionId, w.s.ownerId)).rows[0]!.id;
    await ownerQuery('update execution_problems set cleared_at = now(), cleared_by_correction_id = $2 where id = $1', [ruleProblemId, correctionId]);
    await insertRule();
    const rows = await ownerQuery<{ cleared: boolean }>("select cleared_at is not null as cleared from execution_problems where execution_id = $1 and source = 'rule' order by created_at, id", [executionId]);
    expect(rows.rows.map((r) => r.cleared).sort()).toEqual([false, true]);
  });

  it('allows one non-cancelled audit per execution and requires a comment to reject', async () => {
    const { w, executionId } = await run();
    await auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId, 'cancelled');
    const live = (await auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId)).rows[0]!.id;
    await expect(auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId)).rejects.toThrow(/audits_open_uq/);
    await expect(
      ownerQuery("insert into audit_item_verdicts (tenant_id, audit_id, item_id, verdict, updated_by_user_id, updated_at) values ($1, $2, gen_random_uuid(), 'rejected', $3, now())", [w.s.tenantId, live, w.s.ownerId]),
    ).rejects.toThrow(/audit_item_verdicts_comment_ck/);
  });

  it('backfills the new keys for existing Admin, Manager and Auditor roles and bumps their version', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) =>
      (await ownerQuery<{ id: string; version: number }>('select id, version from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!;
    const before = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key in ('executions.correct', 'audits.perform')", [Object.values(before).map((r) => r.id)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0016_audit_corrections_tables.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    const from = stmts.findIndex((x) => x.includes('SET LOCAL row_security = off'));
    expect(from).toBeGreaterThan(0);
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts.slice(from)) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = async (roleId: string) =>
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key in ('executions.correct', 'audits.perform') order by 1", [roleId])).rows.map((r) => r.k);
    expect(await keys(before.admin.id)).toEqual(['audits.perform', 'executions.correct']);
    expect(await keys(before.manager.id)).toEqual(['executions.correct']);
    expect(await keys(before.auditor.id)).toEqual(['audits.perform']);
    expect(await keys(before.worker.id)).toEqual([]);
    for (const key of ['admin', 'manager', 'auditor'] as const) expect((await roleOf(key)).version, key).toBe(before[key].version + 1);
    expect((await roleOf('worker')).version).toBe(before.worker.version);
  });

  it('gives a new tenant’s Manager and Auditor the keys from the role defaults', async () => {
    const s = await signupTenant(t);
    const keysOf = async (key: string) =>
      (await ownerQuery<{ k: string }>(
        "select rp.permission_key as k from role_permissions rp join roles r on r.id = rp.role_id where r.tenant_id = $1 and r.system_key = $2 and rp.permission_key in ('executions.correct', 'audits.perform')",
        [s.tenantId, key],
      )).rows.map((r) => r.k);
    expect(await keysOf('manager')).toEqual(['executions.correct']);
    expect(await keysOf('auditor')).toEqual(['audits.perform']);
  });
});

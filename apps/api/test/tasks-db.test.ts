import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, executionWorld } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { insertTaskRow } from './task-fixtures';

const TABLES = ['tasks', 'task_submissions', 'task_media', 'task_status_history'];

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

describe('task tables', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
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

  it('needs a person or a team, and hides another tenant’s tasks', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    await expect(insertTaskRow({ tenantId: a.tenantId, createdBy: a.ownerId })).rejects.toThrow(/tasks_assignee_ck/);
    const id = await insertTaskRow({ tenantId: a.tenantId, createdBy: a.ownerId, assigneeUserId: a.ownerId });
    expect((await asApp(b.tenantId, (c) => c.query('select id from tasks'))).rowCount).toBe(0);
    expect((await asApp(a.tenantId, (c) => c.query('select id from tasks'))).rows).toEqual([{ id }]);
  });

  it('keeps history append-only and never lets the app delete task rows', async () => {
    const a = await signupTenant(t);
    const id = await insertTaskRow({ tenantId: a.tenantId, createdBy: a.ownerId, assigneeUserId: a.ownerId });
    await ownerQuery("insert into task_status_history (id, tenant_id, task_id, to_status, at) values (gen_random_uuid(), $1, $2, 'new', now())", [a.tenantId, id]);
    await asApp(a.tenantId, async (c) => {
      for (const stmt of ["update task_status_history set comment = 'x'", 'delete from task_status_history', 'delete from task_media', 'delete from task_submissions', 'delete from tasks']) {
        await c.query('savepoint sp');
        await expect(c.query(stmt), stmt).rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint sp');
      }
      expect((await c.query("update tasks set title = 'Yeni ad'")).rowCount).toBe(1);
    });
  });

  it('links one task per problem and keeps the problem while the task exists', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const saved = await w.workers[0].api.put(
      `/api/v1/executions/${executionId}/answers`,
      answersBody(1, { [w.c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Qapı bağlanmır', mediaIds: [] } } }, '2026-11-02T04:20:00.000Z'),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const problemId = (await ownerQuery<{ id: string }>('select id from execution_problems where execution_id = $1', [executionId])).rows[0]!.id;
    const task = { tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId };
    await insertTaskRow(task);
    await expect(insertTaskRow(task)).rejects.toThrow(/tasks_problem_uq/);
    await expect(ownerQuery('delete from execution_problems where id = $1', [problemId])).rejects.toThrow(/tasks_problem_fk/);
  });

  it('backfills the task keys for existing Admin, Manager and Auditor roles', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) => (await ownerQuery<{ id: string }>('select id from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!.id;
    const roles = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key like 'tasks.%'", [Object.values(roles)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0010_tasks_security.sql'), 'utf8');
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
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key like 'tasks.%' order by 1", [roleId])).rows.map((r) => r.k);
    expect(await keys(roles.admin)).toEqual(['tasks.manage', 'tasks.view']);
    expect(await keys(roles.manager)).toEqual(['tasks.manage', 'tasks.view']);
    expect(await keys(roles.auditor)).toEqual(['tasks.view']);
    expect(await keys(roles.worker)).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';
import pg from 'pg';
import { inject } from 'vitest';

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

describe('checklist tables', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function seedChecklist(tenantId: string, ownerId: string) {
    const c = await ownerQuery<{ id: string }>(
      "insert into checklists (id, tenant_id, name, created_by_user_id) values (gen_random_uuid(), $1, 'X', $2) returning id",
      [tenantId, ownerId],
    );
    const v = await ownerQuery<{ id: string }>(
      `insert into checklist_versions (id, tenant_id, checklist_id, state, content, created_by_user_id)
       values (gen_random_uuid(), $1, $2, 'draft', '{}'::jsonb, $3) returning id`,
      [tenantId, c.rows[0]!.id, ownerId],
    );
    return { checklistId: c.rows[0]!.id, versionId: v.rows[0]!.id };
  }

  it('makes published versions immutable, even for raw SQL', async () => {
    const s = await signupTenant(t);
    const { versionId } = await seedChecklist(s.tenantId, s.ownerId);
    await ownerQuery(
      "update checklist_versions set state = 'published', number = 1, published_at = now(), published_by_user_id = $2 where id = $1",
      [versionId, s.ownerId],
    );
    await asApp(s.tenantId, async (c) => {
      await expect(c.query("update checklist_versions set change_note = 'x' where id = $1", [versionId])).rejects.toThrow(/immutable/);
    });
    await asApp(s.tenantId, async (c) => {
      await expect(c.query('delete from checklist_versions where id = $1', [versionId])).rejects.toThrow(/immutable/);
    });
  });

  it('allows deleting a draft and enforces one draft per checklist', async () => {
    const s = await signupTenant(t);
    const { checklistId, versionId } = await seedChecklist(s.tenantId, s.ownerId);
    await expect(
      ownerQuery(
        `insert into checklist_versions (id, tenant_id, checklist_id, state, content, created_by_user_id)
         values (gen_random_uuid(), $1, $2, 'draft', '{}'::jsonb, $3)`,
        [s.tenantId, checklistId, s.ownerId],
      ),
    ).rejects.toThrow(/checklist_versions_one_draft_uq/);
    await asApp(s.tenantId, async (c) => {
      expect((await c.query('delete from checklist_versions where id = $1', [versionId])).rowCount).toBe(1);
    });
  });

  it('isolates checklist rows by tenant', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    await seedChecklist(a.tenantId, a.ownerId);
    await asApp(b.tenantId, async (c) => {
      expect((await c.query('select count(*)::int as n from checklists where tenant_id = $1', [a.tenantId])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from checklist_versions where tenant_id = $1', [a.tenantId])).rows[0].n).toBe(0);
    });
  });

  it('shows tenants only published global templates and no write access', async () => {
    const s = await signupTenant(t);
    await ownerQuery(
      `insert into global_templates (id, name, category, content, item_count, published) values
       (gen_random_uuid(), 'Pub', 'cleaning', '{}'::jsonb, 0, true), (gen_random_uuid(), 'Hidden', 'cleaning', '{}'::jsonb, 0, false)`,
    );
    await asApp(s.tenantId, async (c) => {
      const names = (await c.query('select name from global_templates_published')).rows.map((r) => r.name);
      expect(names).toContain('Pub');
      expect(names).not.toContain('Hidden');
    });
    await asApp(s.tenantId, async (c) => {
      await expect(c.query('select * from global_templates')).rejects.toThrow(/permission denied/);
    });
  });

  it('accepts platform-scope audit rows without a tenant', async () => {
    await ownerQuery("insert into audit_log (id, tenant_id, actor_platform_admin_id, action, entity_type) values (gen_random_uuid(), null, gen_random_uuid(), 'x', 'x')");
    await expect(ownerQuery("insert into audit_log (id, tenant_id, action, entity_type) values (gen_random_uuid(), null, 'x', 'x')")).rejects.toThrow(
      /audit_log_scope_ck/,
    );
  });

  it('backfilled the new permissions for admin roles', async () => {
    const s = await signupTenant(t);
    const r = await ownerQuery<{ permission_key: string }>(
      "select rp.permission_key from role_permissions rp join roles r on r.id = rp.role_id where r.tenant_id = $1 and r.system_key = 'admin'",
      [s.tenantId],
    );
    expect(r.rows.map((x) => x.permission_key)).toEqual(expect.arrayContaining(['checklists.publish', 'templates.manage']));
  });
});

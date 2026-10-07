import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { ownerQuery } from './owner-db';

const A = uuidv7();
const B = uuidv7();
const typeA = uuidv7();
const typeB = uuidv7();
let app: pg.Client;

async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn();
    await app.query('commit');
    return result;
  } catch (e) {
    await app.query('rollback');
    throw e;
  }
}

describe('row-level security', () => {
  beforeAll(async () => {
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'A', $2), ($3, 'B', $4)", [
      A, `rls-a-${A.slice(-8)}`, B, `rls-b-${B.slice(-8)}`,
    ]);
    await ownerQuery("insert into site_types (id, tenant_id, name) values ($1, $2, 'Type A'), ($3, $4, 'Type B')", [
      typeA, A, typeB, B,
    ]);
    app = new pg.Client({ connectionString: inject('db').appUrl });
    await app.connect();
  });
  afterAll(() => app.end());

  it('returns no rows without a tenant context', async () => {
    expect((await app.query('select * from site_types')).rowCount).toBe(0);
    expect((await app.query('select * from tenants')).rowCount).toBe(0);
  });

  it('only shows the current tenant rows', async () => {
    const rows = await asTenant(A, async () => (await app.query('select id from site_types')).rows);
    expect(rows.map((r) => r.id)).toEqual([typeA]);
  });

  it('returns no rows (not an error) after the tenant transaction ends', async () => {
    await asTenant(A, async () => undefined);
    expect((await app.query('select * from site_types')).rowCount).toBe(0);
  });

  it('rejects writes into another tenant', async () => {
    await expect(
      asTenant(A, () => app.query("insert into site_types (id, tenant_id, name) values ($1, $2, 'x')", [uuidv7(), B])),
    ).rejects.toThrow(/row-level security/);
  });

  it('composite foreign keys block cross-tenant references', async () => {
    await expect(
      asTenant(B, () =>
        app.query("insert into sites (id, tenant_id, type_id, name, path) values ($1, $2, $3, 'x', 'x')", [uuidv7(), B, typeA]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('forbids updating or deleting audit_log', async () => {
    await expect(asTenant(A, () => app.query('update audit_log set action = action'))).rejects.toThrow(/permission denied/);
    await expect(asTenant(A, () => app.query('delete from audit_log'))).rejects.toThrow(/permission denied/);
  });

  it('forbids reading platform_admins and rate_limits', async () => {
    await expect(app.query('select * from platform_admins')).rejects.toThrow(/permission denied/);
    await expect(app.query('select * from rate_limits')).rejects.toThrow(/permission denied/);
  });
});

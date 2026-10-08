import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config';
import { AuditService, redactSecrets } from '../src/db/audit.service';
import { DbService } from '../src/db/db.service';
import { auditLog, siteTypes, tenants } from '../src/db/schema';
import { testEnv } from './app';
import { ownerQuery } from './owner-db';

describe('DbService.withTenant', () => {
  let db: DbService;
  const A = uuidv7();
  const B = uuidv7();

  beforeAll(async () => {
    db = new DbService(loadConfig(testEnv()));
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'A', $2), ($3, 'B', $4)", [
      A, `ctx-a-${A.slice(-8)}`, B, `ctx-b-${B.slice(-8)}`,
    ]);
  });
  afterAll(() => db.onModuleDestroy());

  it('scopes reads and writes to the tenant', async () => {
    await db.withTenant(A, null, (tx) => tx.insert(siteTypes).values({ tenantId: A, name: 'Only A' }));
    const seenByB = await db.withTenant(B, null, (tx) => tx.select().from(siteTypes));
    expect(seenByB).toEqual([]);
    const seenByA = await db.withTenant(A, null, (tx) => tx.select().from(siteTypes));
    expect(seenByA.map((r) => r.name)).toContain('Only A');
  });

  it('exposes the transaction and context to nested code', async () => {
    await db.withTenant(A, 'u1', async (tx) => {
      expect(db.tx()).toBe(tx);
      expect(db.context()).toEqual({ tenantId: A, userId: 'u1' });
      await db.withTenant(A, 'u1', async (inner) => expect(inner).toBe(tx));
    });
  });

  it('refuses to nest a different tenant', async () => {
    await expect(db.withTenant(A, null, () => db.withTenant(B, null, async () => 1))).rejects.toThrow(/different tenant/);
  });

  it('rolls back on error', async () => {
    await expect(
      db.withTenant(A, null, async (tx) => {
        await tx.insert(siteTypes).values({ tenantId: A, name: 'rolled back' });
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    const rows = await db.withTenant(A, null, (tx) => tx.select().from(siteTypes).where(eq(siteTypes.name, 'rolled back')));
    expect(rows).toEqual([]);
  });

  it('throws when tx() is used outside a tenant transaction', () => {
    expect(() => db.tx()).toThrow(/No tenant transaction/);
  });

  it('platform connection bypasses RLS', async () => {
    const rows = await db.platform.select({ id: tenants.id }).from(tenants);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([A, B]));
  });
});

describe('AuditService', () => {
  let db: DbService;
  let audit: AuditService;
  const A = uuidv7();

  beforeAll(async () => {
    db = new DbService(loadConfig(testEnv()));
    audit = new AuditService(db);
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'A', $2)", [A, `aud-${A.slice(-8)}`]);
  });
  afterAll(() => db.onModuleDestroy());

  it('records an entry in the current tenant with the current user as actor', async () => {
    const actor = uuidv7();
    await db.withTenant(A, actor, () =>
      audit.record({ action: 'thing.done', entityType: 'thing', entityId: actor, after: { name: 'x', credentialHash: 'h' } }),
    );
    const [row] = await db.withTenant(A, null, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, 'thing.done')));
    expect(row).toMatchObject({ tenantId: A, actorUserId: actor, entityType: 'thing', after: { name: 'x' } });
  });

  it('redacts secret-looking keys recursively', () => {
    expect(redactSecrets({ a: 1, password: 'p', nested: { refreshToken: 't', ok: true }, list: [{ secret: 's' }] })).toEqual({
      a: 1,
      nested: { ok: true },
      list: [{}],
    });
  });
});

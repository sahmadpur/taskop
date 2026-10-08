import type { DataScope } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScopeService } from '../src/common/scope.service';
import { DbService } from '../src/db/db.service';
import { sites, siteTypes, userSites, users } from '../src/db/schema';
import { createTestApp, type TestApp } from './app';
import { createUserDirect, signupTenant } from './fixtures';

describe('ScopeService.usersFilter', () => {
  let t: TestApp;
  let db: DbService;
  const scope = new ScopeService();
  let tenantId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(DbService);
    const s = await signupTenant(t);
    tenantId = s.tenantId;
    ids.owner = s.ownerId;
    for (const name of ['manager', 'managerNoSites', 'w1', 'w2', 'boss', 'mid', 'leaf']) {
      ids[name] = (await createUserDirect(t, tenantId, { fullName: name })).id;
    }
    await db.withTenant(tenantId, null, async (tx) => {
      const [type] = await tx.select().from(siteTypes).limit(1);
      const label = (id: string) => id.replaceAll('-', '');
      const insertSite = async (name: string, parentPath: string | null, parentId: string | null) => {
        const id = uuidv7();
        const path = parentPath ? `${parentPath}.${label(id)}` : label(id);
        await tx.insert(sites).values({ id, tenantId, parentId, typeId: type!.id, name, path });
        return { id, path };
      };
      const a = await insertSite('A', null, null);
      const a1 = await insertSite('A1', a.path, a.id);
      const b = await insertSite('B', null, null);
      await tx.insert(userSites).values([
        { tenantId, userId: ids.manager!, siteId: a.id },
        { tenantId, userId: ids.w1!, siteId: a1.id },
        { tenantId, userId: ids.w2!, siteId: b.id },
      ]);
      await tx.update(users).set({ managerId: ids.boss! }).where(eq(users.id, ids.mid!));
      await tx.update(users).set({ managerId: ids.mid! }).where(eq(users.id, ids.leaf!));
    });
  });
  afterAll(() => t.close());

  const visible = (userId: string, dataScope: DataScope) =>
    db.withTenant(tenantId, null, async (tx) => {
      const rows = await tx.select({ id: users.id }).from(users).where(scope.usersFilter({ userId, dataScope }));
      return rows.map((r) => r.id).sort();
    });

  it('site_subtree shows users at the manager sites and below, plus self', async () => {
    expect(await visible(ids.manager!, 'site_subtree')).toEqual([ids.manager!, ids.w1!].sort());
  });

  it('site_subtree with no sites shows only self', async () => {
    expect(await visible(ids.managerNoSites!, 'site_subtree')).toEqual([ids.managerNoSites!]);
  });

  it('subordinates follows the reporting chain', async () => {
    expect(await visible(ids.boss!, 'subordinates')).toEqual([ids.boss!, ids.mid!, ids.leaf!].sort());
    expect(await visible(ids.mid!, 'subordinates')).toEqual([ids.mid!, ids.leaf!].sort());
  });

  it('own shows only self and all shows everyone', async () => {
    expect(await visible(ids.w2!, 'own')).toEqual([ids.w2!]);
    expect((await visible(ids.owner!, 'all')).length).toBe(8);
  });

  it('fails closed on an unknown data scope', () => {
    expect(() => scope.usersFilter({ userId: ids.owner!, dataScope: 'everyone' as DataScope })).toThrow(/Unhandled data scope/);
  });
});

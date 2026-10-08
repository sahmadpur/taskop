import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { siteLabel } from '../../tenancy/sites.service';
import { seedTenantDefaults } from '../../tenancy/bootstrap';
import * as schema from '../schema';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const db = drizzle(url, { schema });
  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.orgCode, 'demo'));
  if (existing) {
    console.log('Demo tenant already exists');
    await db.$client.end();
    return;
  }
  const tenantId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(schema.tenants).values({ id: tenantId, name: 'Demo MMC', orgCode: 'demo' });
    const roleIds = await seedTenantDefaults(tx, tenantId);
    const [branchType] = await tx.select().from(schema.siteTypes).where(eq(schema.siteTypes.name, 'Filial'));
    const [zoneType] = await tx.select().from(schema.siteTypes).where(eq(schema.siteTypes.name, 'Zona'));
    const site = async (name: string, typeId: string, parent?: { id: string; path: string }) => {
      const id = uuidv7();
      const path = parent ? `${parent.path}.${siteLabel(id)}` : siteLabel(id);
      await tx.insert(schema.sites).values({ id, tenantId, parentId: parent?.id ?? null, typeId, name, path });
      return { id, path };
    };
    const office = await site('Baş ofis', branchType!.id);
    const warehouse = await site('Anbar №1', branchType!.id);
    await site('Qəbul zonası', zoneType!.id, warehouse);

    const ownerId = uuidv7();
    await tx.insert(schema.users).values({
      id: ownerId, tenantId, fullName: 'Demo Sahib', roleId: roleIds.owner, kind: 'staff',
      email: 'owner@demo.taskop.az', credentialHash: await hash('DemoPassword123', ARGON), credentialKind: 'password',
      status: 'active', emailVerifiedAt: new Date(),
    });
    const managerId = uuidv7();
    await tx.insert(schema.users).values({
      id: managerId, tenantId, fullName: 'Leyla Quliyeva', roleId: roleIds.manager, kind: 'staff',
      email: 'manager@demo.taskop.az', credentialHash: await hash('DemoPassword123', ARGON), credentialKind: 'password',
      status: 'active', emailVerifiedAt: new Date(), managerId: ownerId,
    });
    await tx.insert(schema.userSites).values({ tenantId, userId: managerId, siteId: warehouse.id });
    for (const [username, fullName, siteId] of [
      ['elvin', 'Elvin Məmmədov', warehouse.id],
      ['nigar', 'Nigar Səfərli', office.id],
    ] as const) {
      const id = uuidv7();
      await tx.insert(schema.users).values({
        id, tenantId, fullName, roleId: roleIds.worker, kind: 'worker', username,
        credentialHash: await hash('482915', ARGON), credentialKind: 'pin', status: 'active', managerId,
      });
      await tx.insert(schema.userSites).values({ tenantId, userId: id, siteId });
    }
  });
  await db.$client.end();
  console.log('Demo tenant "demo" created.');
  console.log('  Owner:   owner@demo.taskop.az / DemoPassword123');
  console.log('  Manager: manager@demo.taskop.az / DemoPassword123');
  console.log('  Workers: org code "demo", usernames elvin / nigar, PIN 482915');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

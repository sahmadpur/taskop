import { hash } from '@node-rs/argon2';
import { countItems, regenerateIds } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { siteLabel } from '../../tenancy/sites.service';
import { seedTenantDefaults } from '../../tenancy/bootstrap';
import * as schema from '../schema';
import { GLOBAL_TEMPLATE_FIXTURES } from './seed-templates';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

async function seedGlobalTemplates(db: NodePgDatabase<typeof schema>): Promise<void> {
  for (const f of GLOBAL_TEMPLATE_FIXTURES) {
    const content = f.build();
    // Insert once; never overwrite edits made later in the platform builder.
    await db
      .insert(schema.globalTemplates)
      .values({ id: f.id, name: f.name, description: f.description, category: f.category, sortOrder: f.sortOrder, content, itemCount: countItems(content), published: true })
      .onConflictDoNothing();
  }
}

async function seedDemoChecklists(tx: Tx, tenantId: string, ownerId: string): Promise<void> {
  const existing = await tx.select({ id: schema.checklists.id }).from(schema.checklists).where(eq(schema.checklists.tenantId, tenantId)).limit(1);
  if (existing.length) return;
  const cleaning = GLOBAL_TEMPLATE_FIXTURES.find((f) => f.category === 'cleaning')!;
  const warehouse = GLOBAL_TEMPLATE_FIXTURES.find((f) => f.category === 'warehouse')!;
  const by = { createdByUserId: ownerId };
  const published = (number: number, note: string) => ({ state: 'published' as const, number, changeNote: note, publishedByUserId: ownerId, publishedAt: new Date() });

  const dailyId = uuidv7();
  await tx.insert(schema.checklists).values({ id: dailyId, tenantId, name: 'Gündəlik təmizlik yoxlaması', category: 'cleaning', sourceTemplateKind: 'global', sourceTemplateId: cleaning.id, ...by });
  const v1 = regenerateIds(cleaning.build());
  const v2 = structuredClone(v1);
  const extra = structuredClone(v1.sections[2]!.items[2]!);
  extra.id = crypto.randomUUID();
  extra.label = 'Məsul şəxsə məlumat verildi?';
  v2.sections[2]!.items.splice(2, 0, extra);
  const v1Id = uuidv7();
  const v2Id = uuidv7();
  await tx.insert(schema.checklistVersions).values([
    { id: v1Id, tenantId, checklistId: dailyId, content: v1, ...by, ...published(1, 'İlk versiya') },
    { id: v2Id, tenantId, checklistId: dailyId, content: v2, ...by, ...published(2, 'Məsul şəxs sualı əlavə edildi') },
  ]);
  await tx.update(schema.checklists).set({ currentVersionId: v2Id, latestVersionNumber: 2 }).where(eq(schema.checklists.id, dailyId));

  const receivingId = uuidv7();
  await tx.insert(schema.checklists).values({ id: receivingId, tenantId, name: 'Anbar qəbulu', category: 'warehouse', sourceTemplateKind: 'global', sourceTemplateId: warehouse.id, ...by });
  await tx.insert(schema.checklistVersions).values({ tenantId, checklistId: receivingId, state: 'draft', content: regenerateIds(warehouse.build()), ...by });

  const handover = regenerateIds(cleaning.build());
  handover.sections = handover.sections.slice(0, 1);
  await tx.insert(schema.tenantTemplates).values({ tenantId, name: 'Növbə təhvili', category: 'other', content: handover, itemCount: countItems(handover), ...by });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const db = drizzle(url, { schema });
  await seedGlobalTemplates(db);
  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.orgCode, 'demo'));
  if (existing) {
    const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'owner@demo.taskop.az'));
    if (owner) await db.transaction((tx) => seedDemoChecklists(tx, existing.id, owner.id));
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
    await seedDemoChecklists(tx, tenantId, ownerId);
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

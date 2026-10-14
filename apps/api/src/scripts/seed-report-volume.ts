import { hash } from '@node-rs/argon2';
import { addDays, localDateOf, regenerateIds } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import * as schema from '../db/schema';
import { GLOBAL_TEMPLATE_FIXTURES } from '../db/scripts/seed-templates';
import { seedTenantDefaults } from '../tenancy/bootstrap';
import { siteLabel } from '../tenancy/sites.service';

const TZ = 'Asia/Baku';
const BRANCHES = 5;
const ZONES_PER_BRANCH = 9;
const WORKERS = 200;
const ASSIGNMENTS_PER_SITE = 4;
const DAYS = 366;
const TASKS = 2000;
const PASSWORD = 'PerfPassword123';
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/**
 * SP7 spec §9 performance data. Set-based SQL on the owner connection (bypasses RLS); about a minute on a laptop.
 * Statuses are spread with a hash of (assignment, day), so a re-created database gets the same mix.
 */
export async function seedReportVolume(url: string): Promise<void> {
  const db = drizzle(url, { schema });
  try {
    const [existing] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.orgCode, 'perf'));
    if (existing) {
      console.log('Tenant "perf" already exists; nothing to do.');
      return;
    }
    const today = localDateOf(new Date(), TZ);
    const first = addDays(today, 1 - DAYS);
    const tenantId = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(schema.tenants).values({ id: tenantId, name: 'Perf MMC', orgCode: 'perf', timezone: TZ });
      const roleIds = await seedTenantDefaults(tx, tenantId);
      const types = await tx.select().from(schema.siteTypes).where(eq(schema.siteTypes.tenantId, tenantId));
      const typeId = (name: string) => types.find((x) => x.name === name)!.id;

      const siteIds: string[] = [];
      const branchIds: string[] = [];
      for (let b = 1; b <= BRANCHES; b++) {
        const branchId = uuidv7();
        await tx.insert(schema.sites).values({ id: branchId, tenantId, typeId: typeId('Filial'), name: `Filial ${b}`, path: siteLabel(branchId) });
        branchIds.push(branchId);
        siteIds.push(branchId);
        for (let z = 1; z <= ZONES_PER_BRANCH; z++) {
          const id = uuidv7();
          await tx.insert(schema.sites).values({ id, tenantId, parentId: branchId, typeId: typeId('Zona'), name: `Filial ${b} / Zona ${z}`, path: `${siteLabel(branchId)}.${siteLabel(id)}` });
          siteIds.push(id);
        }
      }

      const passwordHash = await hash(PASSWORD, ARGON);
      const ownerId = uuidv7();
      await tx.insert(schema.users).values({
        id: ownerId, tenantId, fullName: 'Perf Sahib', roleId: roleIds.owner, kind: 'staff', email: 'perf-owner@taskop.test',
        credentialHash: passwordHash, credentialKind: 'password', status: 'active', emailVerifiedAt: new Date(),
      });
      const managerId = uuidv7();
      await tx.insert(schema.users).values({
        id: managerId, tenantId, fullName: 'Perf Menecer', roleId: roleIds.manager, kind: 'staff', email: 'perf-manager@taskop.test',
        credentialHash: passwordHash, credentialKind: 'password', status: 'active', emailVerifiedAt: new Date(), managerId: ownerId,
      });
      await tx.insert(schema.userSites).values({ tenantId, userId: managerId, siteId: branchIds[0]! });

      const pinHash = await hash('482915', ARGON);
      const workerIds: string[] = [];
      for (let i = 0; i < WORKERS; i++) {
        const id = uuidv7();
        const n = String(i + 1).padStart(3, '0');
        workerIds.push(id);
        await tx.insert(schema.users).values({ id, tenantId, fullName: `İşçi ${n}`, roleId: roleIds.worker, kind: 'worker', username: `p${n}`, credentialHash: pinHash, credentialKind: 'pin', status: 'active', managerId });
        await tx.insert(schema.userSites).values({ tenantId, userId: id, siteId: siteIds[i % siteIds.length]! });
      }

      const checklistId = uuidv7();
      const versionId = uuidv7();
      await tx.insert(schema.checklists).values({ id: checklistId, tenantId, name: 'Gündəlik yoxlama', createdByUserId: ownerId });
      await tx.insert(schema.checklistVersions).values({
        id: versionId, tenantId, checklistId, content: regenerateIds(GLOBAL_TEMPLATE_FIXTURES[0]!.build()), createdByUserId: ownerId,
        state: 'published', number: 1, changeNote: 'Perf', publishedByUserId: ownerId, publishedAt: new Date(),
      });
      await tx.update(schema.checklists).set({ currentVersionId: versionId, latestVersionNumber: 1 }).where(eq(schema.checklists.id, checklistId));

      // Four assignments per site, each with two of the site's four workers.
      for (let s = 0; s < siteIds.length; s++) {
        const here = workerIds.filter((_, i) => i % siteIds.length === s);
        for (let k = 0; k < ASSIGNMENTS_PER_SITE; k++) {
          const id = uuidv7();
          await tx.insert(schema.assignments).values({ id, tenantId, checklistId, siteId: siteIds[s]!, schedule: {}, timing: {}, status: 'ended', createdByUserId: ownerId });
          await tx.insert(schema.assignmentAssignees).values([here[k % here.length]!, here[(k + 1) % here.length]!].map((userId) => ({ tenantId, assignmentId: id, userId })));
        }
      }

      await tx.execute(sql`
        insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status, status_changed_at, checklist_version_id)
        select gen_random_uuid(), a.tenant_id, a.id, a.checklist_id, a.site_id, d::date,
               (d::date + time '08:00') at time zone ${TZ}, (d::date + time '10:00') at time zone ${TZ}, (d::date + time '11:00') at time zone ${TZ},
               (case when d::date = ${today}::date then 'pending'
                     when h.v < 80 then 'completed' when h.v < 88 then 'missed' when h.v < 95 then 'partial' else 'cancelled' end)::occurrence_status,
               (d::date + time '11:00') at time zone ${TZ}, ${versionId}
          from assignments a
          cross join generate_series(${first}::date, ${today}::date, interval '1 day') d
          cross join lateral (select abs(hashtext(a.id::text || d::text)) % 100 as v) h
         where a.tenant_id = ${tenantId}`);
      await tx.execute(sql`
        insert into occurrence_assignees (tenant_id, occurrence_id, user_id)
        select o.tenant_id, o.id, aa.user_id from occurrences o join assignment_assignees aa on aa.assignment_id = o.assignment_id
         where o.tenant_id = ${tenantId}`);
      await tx.execute(sql`
        insert into executions (id, tenant_id, occurrence_id, checklist_version_id, executor_user_id, state, started_at, started_received_at,
                                completed_at, completed_received_at, last_synced_at, progress, score, device)
        select gen_random_uuid(), o.tenant_id, o.id, o.checklist_version_id,
               (select min(oa.user_id::text)::uuid from occurrence_assignees oa where oa.occurrence_id = o.id),
               (case when o.status = 'completed' then 'completed' else 'partial' end)::execution_state,
               o.starts_at + interval '15 minutes', o.starts_at + interval '16 minutes',
               case when o.status = 'completed' then o.starts_at + interval '50 minutes' end,
               case when o.status = 'completed' then o.starts_at + interval '51 minutes' end,
               o.starts_at + interval '51 minutes',
               '{"answered":10,"total":10,"requiredMissing":0}'::jsonb,
               jsonb_build_object('earned', 0, 'possible', 0, 'percent', 50 + abs(hashtext(o.id::text)) % 51, 'problems', '[]'::jsonb),
               '{"platform":"android","osVersion":"15","appVersion":"1.0.0"}'::jsonb
          from occurrences o
         where o.tenant_id = ${tenantId} and o.status in ('completed', 'partial')`);
      await tx.execute(sql`
        insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity, note)
        select gen_random_uuid(), x.tenant_id, x.id, x.occurrence_id, o.site_id, o.checklist_id, gen_random_uuid(), 'manual',
               (case when abs(hashtext(x.id::text)) % 5 = 0 then 'critical' else 'normal' end)::problem_severity, 'Yoxlama zamanı problem'
          from executions x join occurrences o on o.id = x.occurrence_id
         where x.tenant_id = ${tenantId} and abs(hashtext(x.id::text || 'p')) % 20 = 0`);
      await tx.execute(sql`
        insert into tasks (id, tenant_id, title, created_by_user_id, assignee_user_id, site_id, status, due_at, overdue_at, completed_at, created_at, updated_at)
        select gen_random_uuid(), ${tenantId}, 'Tapşırıq ' || g, ${ownerId},
               (${sql.param(workerIds)}::uuid[])[1 + g % ${WORKERS}], (${sql.param(siteIds)}::uuid[])[1 + g % ${siteIds.length}],
               s.status::task_status, s.due,
               case when s.status not in ('completed', 'cancelled') and s.due < now() then s.due end,
               case when s.status = 'completed' then s.due - interval '1 hour' end,
               s.due - interval '2 days', s.due - interval '2 days'
          from generate_series(1, ${TASKS}) g
          cross join lateral (
            select (array['new', 'accepted', 'in_progress', 'awaiting_review', 'completed', 'completed', 'cancelled'])[1 + g % 7] as status,
                   ((${first}::date + (g % ${DAYS})) + time '12:00') at time zone ${TZ} as due
          ) s`);
    });
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from occurrences where tenant_id = ${tenantId}`)).rows as [{ n: number }];
    console.log(`Tenant "perf" created: ${n} occurrences from ${first} to ${today}.`);
    console.log(`  Owner (all):            perf-owner@taskop.test / ${PASSWORD}`);
    console.log(`  Manager (site_subtree): perf-manager@taskop.test / ${PASSWORD} (Filial 1 and its zones)`);
  } finally {
    await db.$client.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  await seedReportVolume(url);
}

// Run only as a script (tsx seed-report-volume.ts), not when imported.
if (process.argv[1]?.endsWith('seed-report-volume.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

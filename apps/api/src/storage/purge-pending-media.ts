import type { Logger } from '@nestjs/common';
import { MEDIA_LIMITS } from '@taskop/contracts';
import { and, asc, eq, getTableName, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Clock } from '../common/clock';
import { perTenant, tenantsWith } from '../common/per-tenant';
import type { DbService } from '../db/db.service';
import type { executionMedia, taskMedia } from '../db/schema';
import type { S3Service } from './s3.service';

const DAY = 86_400_000;

/** A media table whose pending rows media.cleanup / task-media.cleanup purge; the rows themselves are never deleted. */
export type PendingMediaTable = typeof executionMedia | typeof taskMedia;

export interface PurgeDeps {
  db: DbService;
  clock: Clock;
  s3: S3Service;
  logger: Logger;
}

/**
 * Deletes the storage objects of media still pending after `MEDIA_LIMITS.pendingCleanupDays` (spec §6.7 / §6.5), one
 * RLS transaction per tenant. `parent` is the owning run or task column, logged with each purge.
 */
export async function purgeStalePending(deps: PurgeDeps, table: PendingMediaTable, parent: PgColumn, label: string, only?: string[]): Promise<number> {
  const { db, clock, logger } = deps;
  const cutoff = new Date(+clock.now() - MEDIA_LIMITS.pendingCleanupDays * DAY);
  const tenantIds = await tenantsWith(
    db,
    sql`select distinct tenant_id from ${sql.identifier(getTableName(table))} where status = 'pending' and storage_purged_at is null and created_at <= ${cutoff}`,
    only,
  );
  return perTenant(db, logger, label, tenantIds, () => purgeTenant(deps, table, parent, cutoff));
}

/**
 * Claims the rows first (locked, still pending, not yet purged), then deletes their objects. A confirmation that
 * committed in between is not claimed; one that comes later waits for this transaction (it locks the row) and then
 * finds no object.
 */
async function purgeTenant({ db, clock, s3, logger }: PurgeDeps, table: PendingMediaTable, parent: PgColumn, cutoff: Date): Promise<number> {
  const tx = db.tx();
  const due = tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.status, 'pending'), isNull(table.storagePurgedAt), lte(table.createdAt, cutoff)))
    .orderBy(asc(table.id))
    .limit(1000)
    .for('update', { skipLocked: true });
  const claimed = await tx
    .update(table)
    .set({ storagePurgedAt: clock.now() })
    .where(and(inArray(table.id, due), eq(table.status, 'pending'), isNull(table.storagePurgedAt)))
    .returning({ id: table.id, parentId: parent, storageKey: table.storageKey });
  for (const m of claimed) {
    await s3.delete(m.storageKey);
    logger.warn({ mediaId: m.id, parentId: m.parentId }, 'Medium never confirmed as uploaded; storage object deleted');
  }
  return claimed.length;
}

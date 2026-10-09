import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MEDIA_LIMITS } from '@taskop/contracts';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { perTenant, tenantsWith } from '../common/per-tenant';
import { DbService } from '../db/db.service';
import { executionMedia } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { S3Service } from '../storage/s3.service';

export const MEDIA_CLEANUP_QUEUE = 'media.cleanup';
const DAY = 86_400_000;

/** media.cleanup (spec §6.7): daily, deletes storage objects of media still pending after 14 days; rows stay. */
@Injectable()
export class MediaJobs implements OnModuleInit {
  private readonly logger = new Logger('MediaJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly s3: S3Service,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    // 03:30 UTC = 07:30 in Baku, before the working day.
    this.jobs.define({ name: MEDIA_CLEANUP_QUEUE, cron: '30 3 * * *', handler: (tenantIds) => this.cleanupAll(tenantIds) });
  }

  async cleanupAll(only?: string[]): Promise<number> {
    const cutoff = new Date(+this.clock.now() - MEDIA_LIMITS.pendingCleanupDays * DAY);
    const tenantIds = await tenantsWith(
      this.db,
      sql`select distinct tenant_id from execution_media where status = 'pending' and storage_purged_at is null and created_at <= ${cutoff}`,
      only,
    );
    return perTenant(this.db, this.logger, 'Media cleanup', tenantIds, () => this.cleanupTenant(cutoff));
  }

  private async cleanupTenant(cutoff: Date): Promise<number> {
    const tx = this.db.tx();
    const rows = await tx
      .select({ id: executionMedia.id, executionId: executionMedia.executionId, storageKey: executionMedia.storageKey })
      .from(executionMedia)
      .where(and(eq(executionMedia.status, 'pending'), isNull(executionMedia.storagePurgedAt), lte(executionMedia.createdAt, cutoff)))
      .orderBy(asc(executionMedia.id))
      .limit(1000);
    const now = this.clock.now();
    for (const m of rows) {
      await this.s3.delete(m.storageKey);
      await tx.update(executionMedia).set({ storagePurgedAt: now }).where(eq(executionMedia.id, m.id));
      this.logger.warn({ mediaId: m.id, executionId: m.executionId }, 'Medium never confirmed as uploaded; storage object deleted');
    }
    return rows.length;
  }
}

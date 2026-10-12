import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { executionMedia } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { purgeStalePending } from '../storage/purge-pending-media';
import { S3Service } from '../storage/s3.service';

export const MEDIA_CLEANUP_QUEUE = 'media.cleanup';

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
    return purgeStalePending(
      { db: this.db, clock: this.clock, s3: this.s3, logger: this.logger },
      executionMedia,
      executionMedia.executionId,
      'Media cleanup',
      only,
    );
  }
}

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AUDIT_REPORT_CONTENT_TYPE, auditReportFileName } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { Clock } from '../../common/clock';
import { sanitiseForLog } from '../../common/error.filter';
import { DbService } from '../../db/db.service';
import { audits } from '../../db/schema';
import { MAILER, type Mailer } from '../../mail/mailer';
import { auditReportMail } from '../../mail/templates';
import { JobsService } from '../../scheduling/jobs.service';
import { S3Service } from '../../storage/s3.service';
import { buildAuditReport } from './audit-report-builder';
import { AuditReportLoader } from './audit-report-loader';
import { AUDIT_JOB_QUEUES, AUDIT_REPORT_JOB, type AuditReportJobData } from './queues';

export type AuditReportOutcome = 'sent' | 'stored' | 'missing' | 'failed';

/**
 * Spec §7.2: build the PDF, store it under tenants/{tenantId}/audits/{auditId}/report.pdf, then mail it, one message per
 * recipient. A stored PDF is reused by retries and resends; a failed recipient is logged and skipped (Spec decision 20).
 */
@Injectable()
export class AuditReportJob implements OnModuleInit {
  private readonly logger = new Logger('AuditReportJob');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly s3: S3Service,
    private readonly loader: AuditReportLoader,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.jobs.defineWorker<AuditReportJobData>(
      AUDIT_JOB_QUEUES.report,
      async (job) => {
        await this.run(job);
      },
      {
        retryLimit: AUDIT_REPORT_JOB.retryLimit,
        retryDelay: AUDIT_REPORT_JOB.retryDelay,
        retryDelayMax: AUDIT_REPORT_JOB.retryDelayMax,
        localConcurrency: AUDIT_REPORT_JOB.localConcurrency,
        deadLetter: AUDIT_JOB_QUEUES.dead,
      },
    );
  }

  /** Throws below the 5th failed attempt so pg-boss retries with backoff; on the 5th, marks the report failed. */
  async run(job: AuditReportJobData): Promise<AuditReportOutcome> {
    try {
      return await this.attempt(job);
    } catch (e) {
      const attempts = await this.countFailure(job);
      if (attempts === null || attempts < AUDIT_REPORT_JOB.maxAttempts) throw e;
      this.logger.error(sanitiseForLog(e, null), `The report of audit ${job.auditId} failed ${attempts} times; giving up`);
      await this.db.withTenant(job.tenantId, null, (tx) => tx.update(audits).set({ reportStatus: 'failed', updatedAt: this.clock.now() }).where(eq(audits.id, job.auditId)));
      return 'failed';
    }
  }

  private async attempt(job: AuditReportJobData): Promise<AuditReportOutcome> {
    const state = await this.db.withTenant(job.tenantId, null, async (tx) => {
      const [a] = await tx
        .select({ status: audits.status, reportStatus: audits.reportStatus, key: audits.reportStorageKey, recipients: audits.reportRecipients })
        .from(audits)
        .where(eq(audits.id, job.auditId));
      return a ?? null;
    });
    if (!state || state.status !== 'finished') return 'missing';
    let pdf = state.reportStatus === 'ready' && state.key ? await this.s3.getObject(state.key) : null;
    if (!pdf) {
      const data = await this.loader.load(job.tenantId, job.auditId);
      if (!data) return 'missing';
      pdf = await buildAuditReport(data);
      const key = `tenants/${job.tenantId}/audits/${job.auditId}/report.pdf`;
      await this.s3.putObject(key, pdf, AUDIT_REPORT_CONTENT_TYPE);
      await this.db.withTenant(job.tenantId, null, (tx) =>
        tx.update(audits).set({ reportStatus: 'ready', reportStorageKey: key, updatedAt: this.clock.now() }).where(eq(audits.id, job.auditId)),
      );
    }
    const recipients = job.emails ?? state.recipients;
    if (!recipients.length) return 'stored';
    const info = await this.loader.mailInfo(job.tenantId, job.auditId);
    if (!info) return 'missing';
    const filename = auditReportFileName(info.checklistName, info.localDate);
    let sent = 0;
    for (const to of recipients) {
      try {
        await this.mailer.send(auditReportMail({ to, ...info, pdf, filename }));
        sent++;
      } catch (e) {
        this.logger.warn(sanitiseForLog(e, null), `The report of audit ${job.auditId} could not be mailed to one recipient; the others still get it`);
      }
    }
    if (!sent) throw new Error(`Every audit report e-mail of audit ${job.auditId} failed`);
    await this.db.withTenant(job.tenantId, null, (tx) =>
      tx.update(audits).set({ reportSentAt: this.clock.now(), reportAttempts: 0, updatedAt: this.clock.now() }).where(eq(audits.id, job.auditId)),
    );
    return 'sent';
  }

  /** In its own transaction. Null when it cannot be recorded (pg-boss then retries). */
  private async countFailure(job: AuditReportJobData): Promise<number | null> {
    try {
      return await this.db.withTenant(job.tenantId, null, async (tx) => {
        const [r] = await tx
          .update(audits)
          .set({ reportAttempts: sql`${audits.reportAttempts} + 1` })
          .where(eq(audits.id, job.auditId))
          .returning({ attempts: audits.reportAttempts });
        return r?.attempts ?? null;
      });
    } catch {
      return null;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import {
  type Answers,
  AUDIT_LIMITS,
  auditableItemIds,
  type AuditDetail,
  type AuditDto,
  type AuditItemVerdict,
  type AuditVerdictParams,
  auditReportFileName,
  auditScore,
  canStartAudit,
  type FinishAuditParams,
  isAuditPaused,
  missingVerdicts,
  reportRecipients,
  type SendAuditReportParams,
  statusAfterAuditCancel,
} from '@taskop/contracts';
import { and, asc, count, eq, getTableColumns, inArray, isNull } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { sanitiseForLog } from '../common/error.filter';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { auditItemVerdicts, audits, checklists, executionMedia, occurrences, users } from '../db/schema';
import { AuditLookup } from '../executions/audit-lookup';
import { CorrectionHistory } from '../executions/correction-history';
import { ExecutionLookups, findItem } from '../executions/execution-lookups';
import { ExecutionQueries } from '../executions/execution-queries';
import { type LockedRun, lockRun } from '../executions/run-locks';
import type { Actor } from '../scheduling/actor';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { JobsService } from '../scheduling/jobs.service';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { S3Service } from '../storage/s3.service';
import { type AuditRow, toAuditDto } from './audit-rows';
import { AUDIT_JOB_QUEUES, type AuditReportJobData } from './report/queues';

/** SP8 spec §6.2: formal audits of completed runs. Runs in the request's tenant transaction. */
@Injectable()
export class AuditsService {
  private readonly logger = new Logger('AuditsService');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly writer: OccurrenceWriter,
    private readonly audit: AuditService,
    private readonly executionQueries: ExecutionQueries,
    private readonly history: CorrectionHistory,
    private readonly lookups: ExecutionLookups,
    private readonly auditLookup: AuditLookup,
    private readonly events: DomainEvents,
    private readonly jobs: JobsService,
    private readonly s3: S3Service,
  ) {}

  /**
   * Starts an audit (spec §6.2). An audited run is locked; an existing non-cancelled audit is AUDIT_EXISTS with its id;
   * otherwise canStartAudit decides. completed → audit_pending with the auditor as actor (Spec decision 11).
   */
  async start(a: Actor, executionId: string): Promise<AuditDto> {
    const now = this.clock.now();
    const { e, o } = await lockRun(this.db, this.scope.occurrences(a), executionId);
    if (o.status === 'audited') throw new AppError('EXECUTION_LOCKED');
    const tx = this.db.tx();
    const existing = await this.auditLookup.openAudit(e.id);
    if (existing) throw new AppError('AUDIT_EXISTS', { details: { auditId: existing.id } });
    if (!canStartAudit({ status: o.status, executionState: e.state }, false)) throw new AppError('EXECUTION_NOT_CORRECTABLE');
    const actor = actorColumns(this.db);
    const [row] = await tx
      .insert(audits)
      .values({
        tenantId: e.tenantId,
        executionId: e.id,
        occurrenceId: o.id,
        auditorUserId: actor.userId,
        auditorPlatformAdminId: actor.platformAdminId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: audits.id });
    if (o.status === 'completed') await this.writer.applyTransitions([{ occurrenceId: o.id, from: 'completed', to: 'audit_pending', at: now }]);
    await this.audit.record({ action: 'audit.started', entityType: 'audit', entityId: row!.id, after: { executionId: e.id, occurrenceId: o.id } });
    return this.dto(row!.id);
  }

  /** The audit screen (spec §8.3): the audit, the run's detail, its correction history and the auditable items. */
  async get(a: Actor, auditId: string): Promise<AuditDetail> {
    const row = await this.readable(a, auditId);
    const execution = await this.executionQueries.load(row.executionId);
    const [checklist] = await this.db
      .tx()
      .select({ requiresAudit: checklists.requiresAudit, auditReportEmails: checklists.auditReportEmails })
      .from(checklists)
      .where(eq(checklists.id, execution.occurrence.checklistId));
    return {
      ...(await this.dto(auditId)),
      execution,
      corrections: await this.history.of(row.executionId),
      auditableItemIds: auditableItemIds(execution.content, execution.answers as Answers),
      checklistReportEmails: checklist!.auditReportEmails,
      requiresAudit: checklist!.requiresAudit,
    };
  }

  /** FR-19.04–05. Paused audits take verdicts too; the item must be auditable now (Spec decision 1). Not audit-logged. */
  async setVerdict(a: Actor, auditId: string, itemId: string, input: AuditVerdictParams): Promise<AuditItemVerdict> {
    const now = this.clock.now();
    const { audit, e } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    const content = await this.lookups.content(e.checklistVersionId);
    if (!findItem(content, itemId)) throw new AppError('NOT_FOUND');
    if (!auditableItemIds(content, e.answers as Answers).includes(itemId)) throw new AppError('VALIDATION_FAILED', { fields: { itemId: 'audits.issues.notAuditable' } });
    const actor = actorColumns(this.db);
    const comment = input.comment ? input.comment : null;
    const [row] = await this.db
      .tx()
      .insert(auditItemVerdicts)
      .values({ tenantId: audit.tenantId, auditId, itemId, verdict: input.verdict, comment, updatedByUserId: actor.userId, updatedAt: now })
      .onConflictDoUpdate({ target: [auditItemVerdicts.auditId, auditItemVerdicts.itemId], set: { verdict: input.verdict, comment, updatedByUserId: actor.userId, updatedAt: now } })
      .returning();
    return (await this.verdictDtos([row!]))[0]!;
  }

  async clearVerdict(a: Actor, auditId: string, itemId: string): Promise<void> {
    const { audit } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    await this.db
      .tx()
      .delete(auditItemVerdicts)
      .where(and(eq(auditItemVerdicts.auditId, auditId), eq(auditItemVerdicts.itemId, itemId)));
  }

  /** Spec §3.1, Spec decision 12: back to completed, or audit_pending when required; a sent-back run keeps its status. */
  async cancel(a: Actor, auditId: string, input: { reason: string }): Promise<AuditDto> {
    const now = this.clock.now();
    const { audit, o } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    await this.db.tx().update(audits).set({ status: 'cancelled', cancelledAt: now, cancelReason: input.reason, updatedAt: now }).where(eq(audits.id, auditId));
    const next = statusAfterAuditCancel(await this.auditLookup.requiresAudit(o.checklistId), o.status);
    if (next !== o.status) await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: next, at: now, reason: input.reason }]);
    await this.audit.record({ action: 'audit.cancelled', entityType: 'audit', entityId: auditId, after: { reason: input.reason, status: next } });
    return this.dto(auditId);
  }

  /**
   * FR-19.06 (spec §6.2): an in-progress audit of a run that is not sent back, a verdict on every auditable item, and every
   * medium the answers reference uploaded. Stores the score, the result and the recipients, moves the run to audited (the
   * run is then locked), emits audit.finished and queues the report after commit.
   */
  async finish(a: Actor, auditId: string, input: FinishAuditParams): Promise<AuditDto> {
    const now = this.clock.now();
    const { audit, e, o } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    if (isAuditPaused(o.status)) throw new AppError('AUDIT_PAUSED');
    const tx = this.db.tx();
    const answers = e.answers as Answers;
    const ids = auditableItemIds(await this.lookups.content(e.checklistVersionId), answers);
    const rows = await tx.select({ itemId: auditItemVerdicts.itemId, verdict: auditItemVerdicts.verdict }).from(auditItemVerdicts).where(eq(auditItemVerdicts.auditId, auditId));
    const verdicts = new Map(rows.map((r) => [r.itemId, r.verdict]));
    const missing = missingVerdicts(verdicts, ids);
    if (missing.length) throw new AppError('AUDIT_INCOMPLETE', { details: { itemIds: missing } });
    if (await this.mediaStillUploading(e.id, answers)) throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    const score = auditScore(verdicts, ids);
    const [checklist] = await tx.select({ emails: checklists.auditReportEmails }).from(checklists).where(eq(checklists.id, o.checklistId));
    const recipients = reportRecipients(checklist!.emails, input.extraEmails ?? []);
    // Spec §7.2: a longer merged list is refused, never truncated (the checklist's addresses and the extra ones add up).
    if (recipients.length > AUDIT_LIMITS.recipients) throw new AppError('VALIDATION_FAILED', { fields: { extraEmails: 'audits.issues.tooManyEmails' } });
    const comment = input.comment ? input.comment : null;
    await tx
      .update(audits)
      .set({ status: 'finished', finishedAt: now, result: input.result, auditScore: score, comment, reportStatus: 'pending', reportRecipients: recipients, reportAttempts: 0, updatedAt: now })
      .where(eq(audits.id, auditId));
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: 'audited', at: now }]);
    await this.events.emit('audit.finished', { tenantId: audit.tenantId, auditId, executionId: e.id, occurrenceId: o.id, result: input.result, actorUserId: actorColumns(this.db).userId });
    await this.audit.record({
      action: 'audit.finished',
      entityType: 'audit',
      entityId: auditId,
      after: { result: input.result, score, rejectedItemIds: ids.filter((id) => verdicts.get(id) === 'rejected'), comment, recipients },
    });
    this.queueReport({ tenantId: audit.tenantId, auditId });
    return this.dto(auditId);
  }

  /** GET /audits/:id/report.pdf: the stored PDF; REPORT_NOT_READY while it is pending or after it failed. */
  async report(a: Actor, auditId: string): Promise<{ body: Buffer; filename: string }> {
    const row = await this.readable(a, auditId);
    if (row.reportStatus !== 'ready' || !row.reportStorageKey) throw new AppError('REPORT_NOT_READY');
    const body = await this.s3.getObject(row.reportStorageKey);
    if (!body) throw new AppError('REPORT_NOT_READY');
    const [r] = await this.db
      .tx()
      .select({ name: checklists.name, localDate: occurrences.localDate })
      .from(occurrences)
      .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
      .where(eq(occurrences.id, row.occurrenceId));
    return { body, filename: auditReportFileName(r!.name, r!.localDate) };
  }

  /**
   * POST /audits/:id/report/send: queues the report job for the given addresses (at most 20, refused by the input schema) or the stored recipients. A failed
   * report is rebuilt (spec §7.2). The stored recipients do not change. Audit-logged as audit.report_sent.
   */
  async sendReport(a: Actor, auditId: string, input: SendAuditReportParams): Promise<AuditDto> {
    const { audit } = await this.lockAudit(a, auditId);
    if (audit.status !== 'finished') throw new AppError('REPORT_NOT_READY');
    const rebuilt = audit.reportStatus === 'failed';
    if (rebuilt) await this.db.tx().update(audits).set({ reportStatus: 'pending', reportAttempts: 0, updatedAt: this.clock.now() }).where(eq(audits.id, auditId));
    const recipients = input.emails ?? audit.reportRecipients;
    await this.audit.record({ action: 'audit.report_sent', entityType: 'audit', entityId: auditId, after: { recipients, rebuilt } });
    this.queueReport({ tenantId: audit.tenantId, auditId, ...(input.emails ? { emails: input.emails } : {}) });
    return this.dto(auditId);
  }

  /** After commit. A lost send leaves report_status = pending; POST /audits/:id/report/send queues it again. */
  private queueReport(job: AuditReportJobData): void {
    this.db.afterCommit(async () => {
      try {
        await this.jobs.send(AUDIT_JOB_QUEUES.report, job);
      } catch (e) {
        this.logger.error(sanitiseForLog(e, null), `Queueing the report of audit ${job.auditId} failed`);
      }
    });
  }

  /** Spec §6.2 "MEDIA_PENDING": a medium the answers reference is still pending. A purged one never uploads, so it is ignored. */
  private async mediaStillUploading(executionId: string, answers: Answers): Promise<boolean> {
    const ids = [...new Set(Object.values(answers).flatMap((x) => [...(x?.photos ?? []), ...(x?.videos ?? []), ...(x?.problem?.mediaIds ?? [])]))];
    if (!ids.length) return false;
    const [r] = await this.db
      .tx()
      .select({ n: count() })
      .from(executionMedia)
      .where(and(eq(executionMedia.executionId, executionId), inArray(executionMedia.id, ids), eq(executionMedia.status, 'pending'), isNull(executionMedia.storagePurgedAt)));
    return (r?.n ?? 0) > 0;
  }

  /** The audit and its run, locked in the order of every run command: occurrence, execution, then the audit row. */
  private async lockAudit(a: Actor, auditId: string): Promise<{ audit: AuditRow } & LockedRun> {
    const tx = this.db.tx();
    const [peek] = await tx.select({ executionId: audits.executionId }).from(audits).where(eq(audits.id, auditId));
    if (!peek) throw new AppError('NOT_FOUND');
    const run = await lockRun(this.db, this.scope.occurrences(a), peek.executionId);
    const [audit] = await tx.select().from(audits).where(eq(audits.id, auditId)).for('update');
    return { audit: audit!, ...run };
  }

  /** The audit when its run lies in the actor's data scope; 404 otherwise. */
  private async readable(a: Actor, auditId: string): Promise<AuditRow> {
    const [row] = await this.db
      .tx()
      .select({ a: getTableColumns(audits) })
      .from(audits)
      .innerJoin(occurrences, eq(occurrences.id, audits.occurrenceId))
      .where(and(eq(audits.id, auditId), this.scope.occurrences(a)));
    if (!row) throw new AppError('NOT_FOUND');
    return row.a;
  }

  private async dto(auditId: string): Promise<AuditDto> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ a: getTableColumns(audits), auditorName: users.fullName, status: occurrences.status })
      .from(audits)
      .innerJoin(occurrences, eq(occurrences.id, audits.occurrenceId))
      .leftJoin(users, eq(users.id, audits.auditorUserId))
      .where(eq(audits.id, auditId));
    const verdicts = await tx.select().from(auditItemVerdicts).where(eq(auditItemVerdicts.auditId, auditId)).orderBy(asc(auditItemVerdicts.updatedAt), asc(auditItemVerdicts.itemId));
    return toAuditDto(row!.a, row!.auditorName, row!.status, await this.verdictDtos(verdicts));
  }

  private async verdictDtos(rows: (typeof auditItemVerdicts.$inferSelect)[]): Promise<AuditItemVerdict[]> {
    const ids = [...new Set(rows.map((r) => r.updatedByUserId).filter((id): id is string => id !== null))];
    const names = ids.length ? await this.db.tx().select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    return rows.map((r) => {
      const by = names.find((n) => n.id === r.updatedByUserId);
      return { itemId: r.itemId, verdict: r.verdict, comment: r.comment, updatedBy: by ? { id: by.id, fullName: by.fullName } : null, updatedAt: r.updatedAt.toISOString() };
    });
  }
}

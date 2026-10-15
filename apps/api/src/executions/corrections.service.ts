import { Injectable } from '@nestjs/common';
import {
  type Answer,
  type Answers,
  answerIssues,
  canWithdrawSendBack,
  changedItemIds,
  type ChecklistContent,
  type CorrectAnswersParams,
  type CorrectionResult,
  type OccurrenceStatus,
  requirements,
  type ReworkRequest,
  type ScoreResult,
  type SendBackParams,
  walkItems,
} from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { executionCorrections, executionReworkRequests, executions } from '../db/schema';
import type { Actor } from '../scheduling/actor';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { AuditLookup } from './audit-lookup';
import { applyCorrection } from './correction-apply';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionRecalculator } from './recalculation';
import { ReworkRequests } from './rework-requests';
import { assertCorrectable, lockRun, snapshotColumns } from './run-locks';

/** Only the changed items, for the audit log (spec §6.4). */
export const pickAnswers = (answers: Answers, ids: readonly string[]): Record<string, Answer | null> =>
  Object.fromEntries(ids.map((id) => [id, answers[id] ?? null]));

/** The item ids in the checklist's own order (sections, then items), so rows never depend on jsonb key order. */
export function inChecklistOrder(content: ChecklistContent, ids: readonly string[]): string[] {
  const position = new Map<string, number>();
  walkItems(content, (item) => position.set(item.id, position.size));
  return [...ids].sort((x, y) => (position.get(x) ?? Number.MAX_SAFE_INTEGER) - (position.get(y) ?? Number.MAX_SAFE_INTEGER));
}

/** SP8 spec §6.2: a manager's direct corrections, send-back and withdrawal. Runs in the request's tenant transaction. */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly audit: AuditService,
    private readonly lookups: ExecutionLookups,
    private readonly recalculator: ExecutionRecalculator,
    private readonly writer: OccurrenceWriter,
    private readonly events: DomainEvents,
    private readonly requests: ReworkRequests,
    private readonly audits: AuditLookup,
  ) {}

  /**
   * FR-19.09–14: one correction row per changed item, the snapshot on the first change, then the recalculation.
   * `answersRev` must match the stored rev (Spec decision 4); nothing changed answers 200 and writes nothing.
   */
  async correct(a: Actor, id: string, input: CorrectAnswersParams): Promise<CorrectionResult> {
    const now = this.clock.now();
    const run = await lockRun(this.db, this.scope.occurrences(a), id);
    assertCorrectable(run);
    const { e, o } = run;
    if (input.answersRev !== e.answersRev) throw new AppError('ANSWERS_CONFLICT');
    const content = await this.lookups.content(e.checklistVersionId);
    const before = e.answers as Answers;
    const after = applyCorrection(content, before, input.changes);
    const issues = answerIssues(content, after, await this.lookups.registeredMedia(e.id));
    if (issues.length) throw new AppError('VALIDATION_FAILED', { details: { issues } });
    // Spec decision 3: a correction must leave the run completable.
    const missing = requirements(content, after);
    if (missing.length) throw new AppError('REQUIREMENTS_UNMET', { details: { missing } });
    const changed = inChecklistOrder(content, changedItemIds(before, after));
    if (!changed.length) return { executionId: e.id, answersRev: e.answersRev, changedItemIds: [], score: (e.score as ScoreResult | null) ?? null };

    const tx = this.db.tx();
    const actor = actorColumns(this.db);
    const rows = await tx
      .insert(executionCorrections)
      .values(
        changed.map((itemId) => ({
          tenantId: e.tenantId,
          executionId: e.id,
          itemId,
          kind: 'manual' as const,
          round: e.reworkRound,
          before: before[itemId] ?? null,
          after: after[itemId] ?? null,
          reason: input.reason,
          actorUserId: actor.userId,
          actorPlatformAdminId: actor.platformAdminId,
          at: now,
        })),
      )
      .returning({ id: executionCorrections.id, itemId: executionCorrections.itemId });
    await tx
      .update(executions)
      .set({ answers: after, answersRev: e.answersRev + 1, updatedAt: now, ...snapshotColumns(e, now) })
      .where(eq(executions.id, e.id));
    // Spec R20: only directly corrected items link their cleared problem to a correction row.
    const { score } = await this.recalculator.recalculate({ execution: e, occurrence: o, content, answers: after, clearedBy: new Map(rows.map((r) => [r.itemId, r.id])), now });
    await this.resetAuditVerdicts(e.id, changed);
    await this.audit.record({
      action: 'execution.corrected',
      entityType: 'execution',
      entityId: e.id,
      before: { answers: pickAnswers(before, changed) },
      after: { answers: pickAnswers(after, changed), reason: input.reason },
    });
    return { executionId: e.id, answersRev: e.answersRev + 1, changedItemIds: changed, score };
  }

  /**
   * FR-19.15: only the flagged items reopen, each with a comment. The run moves to correction_required and its execution
   * to rework; the snapshot is taken if this is the first change. `dueAt` is informational (spec §3.2).
   */
  async sendBack(a: Actor, id: string, input: SendBackParams): Promise<ReworkRequest> {
    const now = this.clock.now();
    const run = await lockRun(this.db, this.scope.occurrences(a), id);
    assertCorrectable(run);
    const { e, o } = run;
    const content = await this.lookups.content(e.checklistVersionId);
    const known = new Set<string>();
    walkItems(content, (item) => known.add(item.id));
    const fields: Record<string, string> = {};
    input.items.forEach((x, i) => {
      if (!known.has(x.itemId)) fields[`items.${i}.itemId`] = 'executions.issues.unknownItem';
    });
    if (input.dueAt && new Date(input.dueAt) <= now) fields.dueAt = 'corrections.issues.dueInPast';
    if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', { fields });

    const tx = this.db.tx();
    const actor = actorColumns(this.db);
    const round = e.reworkRound + 1;
    const [request] = await tx
      .insert(executionReworkRequests)
      .values({
        tenantId: e.tenantId,
        executionId: e.id,
        round,
        items: input.items,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        requestedByUserId: actor.userId,
        requestedByPlatformAdminId: actor.platformAdminId,
        requestedAt: now,
        answersBefore: e.answers,
        statusBefore: o.status,
      })
      .returning();
    await tx
      .update(executions)
      .set({ state: 'rework', reworkRound: round, updatedAt: now, ...snapshotColumns(e, now) })
      .where(eq(executions.id, e.id));
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: 'correction_required', at: now }]);
    await this.events.emit('execution.sent_back', { tenantId: e.tenantId, executionId: e.id, occurrenceId: o.id, round, actorUserId: actor.userId });
    await this.audit.record({ action: 'execution.sent_back', entityType: 'execution', entityId: e.id, after: { round, items: input.items, dueAt: input.dueAt ?? null } });
    return (await this.requests.toDtos([request!]))[0]!;
  }

  /**
   * Spec §6.2 with ruling R7: withdraws the open send-back. The run returns to the status it had (Spec decision 22), its
   * execution to completed, and its answers to the request's `answers_before` (rev + 1), so whatever the worker saved
   * during the abandoned rework is dropped. Score and problems are recalculated; no correction rows are written.
   */
  async withdraw(a: Actor, id: string): Promise<ReworkRequest> {
    const now = this.clock.now();
    const { e, o } = await lockRun(this.db, this.scope.occurrences(a), id);
    if (o.status === 'audited') throw new AppError('EXECUTION_LOCKED');
    const open = await this.requests.open(e.id);
    if (!open || !canWithdrawSendBack({ status: o.status, executionState: e.state })) throw new AppError('EXECUTION_NOT_CORRECTABLE');
    const tx = this.db.tx();
    const actor = actorColumns(this.db);
    const [row] = await tx
      .update(executionReworkRequests)
      .set({ withdrawnAt: now, withdrawnByUserId: actor.userId })
      .where(eq(executionReworkRequests.id, open.id))
      .returning();
    const content = await this.lookups.content(e.checklistVersionId);
    const current = e.answers as Answers;
    const restored = open.answersBefore as Answers;
    const reverted = inChecklistOrder(content, changedItemIds(current, restored));
    await tx
      .update(executions)
      .set({ state: 'completed', answers: restored, answersRev: e.answersRev + 1, updatedAt: now })
      .where(eq(executions.id, e.id));
    await this.recalculator.recalculate({ execution: e, occurrence: o, content, answers: restored, clearedBy: new Map(), now });
    await this.resetAuditVerdicts(e.id, reverted);
    const back = await this.statusAfterWithdraw(open.statusBefore, o.checklistId, e.id);
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: back, at: now }]);
    await this.audit.record({
      action: 'execution.send_back_withdrawn',
      entityType: 'execution',
      entityId: e.id,
      before: { round: open.round, ...(reverted.length ? { answers: pickAnswers(current, reverted) } : {}) },
      after: { status: back, ...(reverted.length ? { answers: pickAnswers(restored, reverted) } : {}) },
    });
    return (await this.requests.toDtos([row!]))[0]!;
  }

  /**
   * Ruling F2: like a resubmit (spec decision 7), a correction or a withdrawal that changes items under an audit in
   * progress clears their verdicts, so the auditor never approves a value they did not see.
   */
  private async resetAuditVerdicts(executionId: string, itemIds: readonly string[]): Promise<void> {
    if (!itemIds.length) return;
    const audit = await this.audits.openAudit(executionId);
    if (audit?.status === 'in_progress') await this.audits.resetVerdicts(audit.id, itemIds);
  }

  /** Spec decision 22: audit_pending only while an audit exists or the checklist requires one. */
  private async statusAfterWithdraw(before: OccurrenceStatus, checklistId: string, executionId: string): Promise<OccurrenceStatus> {
    if (before !== 'audit_pending') return before;
    if (await this.audits.requiresAudit(checklistId)) return before;
    return (await this.audits.openAudit(executionId)) ? before : 'completed';
  }
}

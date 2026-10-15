import { Injectable } from '@nestjs/common';
import {
  type Answers,
  changedItemIds,
  type ChecklistContent,
  type ExecutionProgress,
  nextStatusAfterResubmit,
  type OccurrenceStatus,
  requirements,
  type ResubmitResult,
  type ReworkItem,
  type ScoreResult,
  visibleItems,
} from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { executionCorrections, executionReworkRequests, executions } from '../db/schema';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { AuditLookup } from './audit-lookup';
import { inChecklistOrder, pickAnswers } from './corrections.service';
import { assertDeviceTimes } from './device-time';
import type { ResubmitCommandDto } from './dto';
import { ExecutionLookups } from './execution-lookups';
import type { ExecutionRow } from './executions.service';
import { ExecutionRecalculator } from './recalculation';
import { ReworkRequests } from './rework-requests';
import { lockOwnRun } from './run-locks';

/**
 * The reason of a rework correction (Spec decision 28): the item's own comment when it was flagged, else the comment of
 * its nearest flagged ancestor (a follow-up the flagged change revealed or hid), else the first flagged item's comment.
 */
export function reworkReason(content: ChecklistContent, before: Answers, after: Answers, items: readonly ReworkItem[]): (itemId: string) => string {
  const comments = new Map(items.map((x) => [x.itemId, x.comment]));
  const parents = new Map<string, string | null>();
  for (const v of [...visibleItems(content, before), ...visibleItems(content, after)]) parents.set(v.item.id, v.parentId);
  return (itemId) => {
    const seen = new Set<string>();
    for (let id: string | null | undefined = itemId; id && !seen.has(id); id = parents.get(id)) {
      seen.add(id);
      const comment = comments.get(id);
      if (comment) return comment;
    }
    return items[0]?.comment ?? '';
  };
}

/** POST /executions/:id/resubmit (SP8 spec §6.2): closes a rework round. Runs in the request's tenant transaction. */
@Injectable()
export class ReworkService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: OccurrenceWriter,
    private readonly lookups: ExecutionLookups,
    private readonly recalculator: ExecutionRecalculator,
    private readonly requests: ReworkRequests,
    private readonly audits: AuditLookup,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  /**
   * Requirements, then one `rework` correction per changed item (the manager's comment as the reason), recalculation,
   * resubmitted_at, state completed and the status of nextStatusAfterResubmit. Verdicts of an open audit on the changed
   * items are reset (Spec decision 7). completed_at, completed_received_at and late keep their first values.
   * Idempotent: a repeat after success answers 200 (Spec decision 6).
   */
  async resubmit(p: Principal, id: string, cmd: ResubmitCommandDto): Promise<ResubmitResult> {
    const receivedAt = this.clock.now();
    const { e, o } = await lockOwnRun(this.db, p, id);
    const resubmittedAt = new Date(cmd.resubmittedAt);
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), resubmittedAt], receivedAt, cmd.clientOffsetMs);
    if (e.state === 'completed' && (await this.requests.latest(e.id))?.resubmittedAt) return this.result(e, o.status);
    if (e.state !== 'rework') throw new AppError('EXECUTION_NOT_ACTIVE');
    const request = await this.requests.open(e.id);
    if (!request) throw new AppError('EXECUTION_NOT_ACTIVE');
    const content = await this.lookups.content(e.checklistVersionId);
    const answers = e.answers as Answers;
    const missing = requirements(content, answers);
    if (missing.length) throw new AppError('REQUIREMENTS_UNMET', { details: { missing } });

    const tx = this.db.tx();
    const before = request.answersBefore as Answers;
    const items = request.items as ReworkItem[];
    // Spec decision 28: rows for every changed item visible before or after; a leftover answer hidden on both sides is not a correction.
    const shown = new Set([...visibleItems(content, before), ...visibleItems(content, answers)].map((v) => v.item.id));
    const changed = inChecklistOrder(content, changedItemIds(before, answers).filter((id) => shown.has(id)));
    const reasonOf = reworkReason(content, before, answers, items);
    const rows = changed.length
      ? await tx
          .insert(executionCorrections)
          .values(
            changed.map((itemId) => ({
              tenantId: e.tenantId,
              executionId: e.id,
              itemId,
              kind: 'rework' as const,
              round: request.round,
              before: before[itemId] ?? null,
              after: answers[itemId] ?? null,
              reason: reasonOf(itemId),
              actorUserId: p.userId,
              at: receivedAt,
            })),
          )
          .returning({ id: executionCorrections.id, itemId: executionCorrections.itemId })
      : [];
    const { score, progress } = await this.recalculator.recalculate({
      execution: e,
      occurrence: o,
      content,
      answers,
      clearedBy: new Map(rows.map((r) => [r.itemId, r.id])),
      now: receivedAt,
    });
    await tx.update(executionReworkRequests).set({ resubmittedAt }).where(eq(executionReworkRequests.id, request.id));
    await tx
      .update(executions)
      .set({ state: 'completed', lastSyncedAt: receivedAt, clockOffsetMs: cmd.clientOffsetMs, clockSuspect: e.clockSuspect || bounds.clockSuspect, updatedAt: receivedAt })
      .where(eq(executions.id, e.id));
    const audit = await this.audits.openAudit(e.id);
    const status = nextStatusAfterResubmit(await this.audits.requiresAudit(o.checklistId), audit !== null);
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: status, at: resubmittedAt }]);
    if (audit?.status === 'in_progress') await this.audits.resetVerdicts(audit.id, changed);
    await this.events.emit('execution.resubmitted', { tenantId: e.tenantId, executionId: e.id, occurrenceId: o.id, round: request.round, actorUserId: p.userId });
    await this.audit.record({
      action: 'execution.resubmitted',
      entityType: 'execution',
      entityId: e.id,
      before: { answers: pickAnswers(before, changed) },
      after: { answers: pickAnswers(answers, changed), round: request.round, status },
    });
    return { executionId: e.id, state: 'completed', status, progress, score };
  }

  private result(e: ExecutionRow, status: OccurrenceStatus): ResubmitResult {
    return { executionId: e.id, state: e.state, status, progress: e.progress as ExecutionProgress, score: (e.score as ScoreResult | null) ?? null };
  }
}

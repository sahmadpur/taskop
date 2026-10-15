import { Injectable } from '@nestjs/common';
import { type Answer, type Answers, answerIssues, changedItemIds, type ChecklistContent, type CorrectAnswersParams, type CorrectionResult, requirements, type ScoreResult, walkItems } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { executionCorrections, executions } from '../db/schema';
import type { Actor } from '../scheduling/actor';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { applyCorrection } from './correction-apply';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionRecalculator } from './recalculation';
import { assertCorrectable, lockRun, snapshotColumns } from './run-locks';

/** Only the changed items, for the audit log (spec §6.4). */
export const pickAnswers = (answers: Answers, ids: readonly string[]): Record<string, Answer | null> =>
  Object.fromEntries(ids.map((id) => [id, answers[id] ?? null]));

/** The item ids in the checklist's own order (sections, then items), so rows never depend on jsonb key order. */
function inChecklistOrder(content: ChecklistContent, ids: readonly string[]): string[] {
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
    await this.audit.record({
      action: 'execution.corrected',
      entityType: 'execution',
      entityId: e.id,
      before: { answers: pickAnswers(before, changed) },
      after: { answers: pickAnswers(after, changed), reason: input.reason },
    });
    return { executionId: e.id, answersRev: e.answersRev + 1, changedItemIds: changed, score };
  }
}

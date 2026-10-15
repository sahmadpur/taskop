import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, type DerivedProblem, deriveProblems } from '@taskop/contracts';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';

type ExecutionRef = { id: string; tenantId: string };
type OccurrenceRef = { id: string; siteId: string; checklistId: string };

@Injectable()
export class ProblemWriter {
  constructor(
    private readonly db: DbService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * While the run is open: rewrites a counted execution's problems from its answers (spec §5.2). Upserting on (execution,
   * item, source) keeps a problem's id and created_at while it persists; problems that are gone are deleted, unless a
   * task was created from them.
   */
  async rewrite(e: ExecutionRef, o: OccurrenceRef, content: ChecklistContent, answers: Answers, now: Date): Promise<void> {
    const derived = deriveProblems(content, answers);
    await this.upsert(e, o, derived, now);
    const keep = derived.map((d) => `${d.itemId}:${d.source}`);
    await this.db
      .tx()
      .delete(executionProblems)
      .where(
        and(
          isNull(executionProblems.clearedAt),
          eq(executionProblems.executionId, e.id),
          keep.length ? notInArray(sql<string>`${executionProblems.itemId}::text || ':' || ${executionProblems.source}::text`, keep) : undefined,
          // A problem turned into a task stays (spec §5): a late answers sync on a swept run may no longer derive it.
          sql`not exists (select 1 from tasks k where k.problem_id = ${executionProblems.id})`,
        ),
      );
  }

  /**
   * After the run closed, for corrections and resubmits (SP8 spec §6.3): rule and manual problems, and nothing is deleted.
   * A problem the answers no longer carry is cleared and points at the correction of its item (`clearedBy`); a new one is
   * inserted; a kept one gets the new severity, note and media. A task made from any problem keeps its link.
   */
  async rewriteAfterClose(
    e: ExecutionRef,
    o: OccurrenceRef,
    content: ChecklistContent,
    answers: Answers,
    clearedBy: ReadonlyMap<string, string>,
    now: Date,
  ): Promise<void> {
    const derived = deriveProblems(content, answers);
    await this.upsert(e, o, derived, now);
    const kept = new Set(derived.map((d) => `${d.itemId}:${d.source}`));
    const tx = this.db.tx();
    const active = await tx
      .select({ id: executionProblems.id, itemId: executionProblems.itemId, source: executionProblems.source })
      .from(executionProblems)
      .where(and(eq(executionProblems.executionId, e.id), isNull(executionProblems.clearedAt)));
    for (const p of active) {
      if (kept.has(`${p.itemId}:${p.source}`)) continue;
      await tx
        .update(executionProblems)
        .set({ clearedAt: now, clearedByCorrectionId: clearedBy.get(p.itemId) ?? null, updatedAt: now })
        .where(eq(executionProblems.id, p.id));
    }
  }

  /** Upserts on the item's active row. Each row it inserts (not a re-save) emits problem.recorded (SP6 spec §6.1). */
  private async upsert(e: ExecutionRef, o: OccurrenceRef, derived: DerivedProblem[], now: Date): Promise<void> {
    if (!derived.length) return;
    const rows = await this.db
      .tx()
      .insert(executionProblems)
      .values(
        derived.map((d) => ({
          tenantId: e.tenantId,
          executionId: e.id,
          occurrenceId: o.id,
          siteId: o.siteId,
          checklistId: o.checklistId,
          itemId: d.itemId,
          source: d.source,
          severity: d.severity,
          note: d.note,
          mediaIds: d.mediaIds,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [executionProblems.executionId, executionProblems.itemId, executionProblems.source],
        // The partial unique index execution_problems_active_item_uq.
        targetWhere: sql`cleared_at is null`,
        set: { severity: sql`excluded.severity`, note: sql`excluded.note`, mediaIds: sql`excluded.media_ids`, updatedAt: now },
      })
      // xmax = 0 only for rows this statement inserted; an updated (re-saved) row carries this transaction's id.
      .returning({ id: executionProblems.id, severity: executionProblems.severity, inserted: sql<boolean>`(xmax = 0)` });
    const actorUserId = actorColumns(this.db).userId;
    for (const r of rows) {
      if (!r.inserted) continue;
      await this.events.emit('problem.recorded', { tenantId: e.tenantId, problemId: r.id, occurrenceId: o.id, severity: r.severity, actorUserId });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, deriveProblems } from '@taskop/contracts';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';

@Injectable()
export class ProblemWriter {
  constructor(
    private readonly db: DbService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Rewrites a counted execution's problems from its answers (spec §5.2). Upserting on (execution, item, source)
   * keeps a problem's id and created_at while it persists; problems that are gone are deleted, unless a task was created from them.
   * Each row the upsert inserts (not a re-save) emits problem.recorded (SP6 spec §6.1).
   */
  async rewrite(
    e: { id: string; tenantId: string },
    o: { id: string; siteId: string; checklistId: string },
    content: ChecklistContent,
    answers: Answers,
    now: Date,
  ): Promise<void> {
    const tx = this.db.tx();
    const derived = deriveProblems(content, answers);
    if (derived.length) {
      const rows = await tx
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
    const keep = derived.map((d) => `${d.itemId}:${d.source}`);
    await tx
      .delete(executionProblems)
      .where(
        and(
          eq(executionProblems.executionId, e.id),
          keep.length ? notInArray(sql<string>`${executionProblems.itemId}::text || ':' || ${executionProblems.source}::text`, keep) : undefined,
          // A problem turned into a task stays (spec §5): a late answers sync on a swept run may no longer derive it.
          sql`not exists (select 1 from tasks k where k.problem_id = ${executionProblems.id})`,
        ),
      );
  }
}

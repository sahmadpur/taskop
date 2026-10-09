import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, deriveProblems } from '@taskop/contracts';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';

@Injectable()
export class ProblemWriter {
  constructor(private readonly db: DbService) {}

  /**
   * Rewrites a counted execution's problems from its answers (spec §5.2). Upserting on (execution, item, source)
   * keeps a problem's id and created_at while it persists; problems that are gone are deleted.
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
      await tx
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
        });
    }
    const keep = derived.map((d) => `${d.itemId}:${d.source}`);
    await tx
      .delete(executionProblems)
      .where(
        and(
          eq(executionProblems.executionId, e.id),
          keep.length ? notInArray(sql<string>`${executionProblems.itemId}::text || ':' || ${executionProblems.source}::text`, keep) : undefined,
        ),
      );
  }
}

import { Injectable } from '@nestjs/common';
import { type AuditBrief, type AuditScore, isAuditPaused, type OccurrenceStatus } from '@taskop/contracts';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { auditItemVerdicts, audits, checklists } from '../db/schema';

/**
 * What the executions module needs to know about audits (Architecture: "Module boundary"): plain reads and writes of
 * the audit tables, so `executions` never imports the `audits` module, which depends on it.
 */
@Injectable()
export class AuditLookup {
  constructor(private readonly db: DbService) {}

  async requiresAudit(checklistId: string): Promise<boolean> {
    const [c] = await this.db.tx().select({ requiresAudit: checklists.requiresAudit }).from(checklists).where(eq(checklists.id, checklistId));
    return c?.requiresAudit ?? false;
  }

  /** The run's non-cancelled audit (at most one: audits_open_uq). */
  async openAudit(executionId: string): Promise<{ id: string; status: 'in_progress' | 'finished' } | null> {
    const [a] = await this.db
      .tx()
      .select({ id: audits.id, status: audits.status })
      .from(audits)
      .where(and(eq(audits.executionId, executionId), ne(audits.status, 'cancelled')));
    return a ? { id: a.id, status: a.status as 'in_progress' | 'finished' } : null;
  }

  /** ExecutionDetail.audit: the non-cancelled audit, else the latest cancelled one; null when none was started. */
  async brief(executionId: string, occurrenceStatus: OccurrenceStatus): Promise<AuditBrief | null> {
    const [a] = await this.db
      .tx()
      .select({ id: audits.id, status: audits.status, result: audits.result, score: audits.auditScore })
      .from(audits)
      .where(eq(audits.executionId, executionId))
      .orderBy(sql`${audits.status} = 'cancelled'`, desc(audits.startedAt), desc(audits.id))
      .limit(1);
    if (!a) return null;
    return {
      id: a.id,
      status: a.status,
      result: a.result,
      percent: (a.score as AuditScore | null)?.percent ?? null,
      paused: a.status === 'in_progress' && isAuditPaused(occurrenceStatus),
    };
  }

  /** Spec decision 7: the auditor reviews the items a rework changed again. */
  async resetVerdicts(auditId: string, itemIds: readonly string[]): Promise<void> {
    if (!itemIds.length) return;
    await this.db
      .tx()
      .delete(auditItemVerdicts)
      .where(and(eq(auditItemVerdicts.auditId, auditId), inArray(auditItemVerdicts.itemId, [...itemIds])));
  }
}

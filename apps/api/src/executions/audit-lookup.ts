import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { audits, checklists } from '../db/schema';

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
}

import { Injectable } from '@nestjs/common';
import type { ExecutionSummary } from '@taskop/contracts';
import { asc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executions, users } from '../db/schema';
import { executionSummaryColumns, toExecutionSummary } from '../executions/mappers';

/** The executions of one occurrence for its detail (SP4 spec §6.8). Plain reads; no dependency on the executions module. */
@Injectable()
export class OccurrenceExecutions {
  constructor(private readonly db: DbService) {}

  async forOccurrence(occurrenceId: string): Promise<{ execution: ExecutionSummary | null; rejectedExecutions: ExecutionSummary[] }> {
    const rows = await this.db
      .tx()
      .select(executionSummaryColumns)
      .from(executions)
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .where(eq(executions.occurrenceId, occurrenceId))
      .orderBy(asc(executions.startedAt), asc(executions.id));
    const all = rows.map(toExecutionSummary);
    return { execution: all.find((s) => s.state !== 'rejected') ?? null, rejectedExecutions: all.filter((s) => s.state === 'rejected') };
  }
}

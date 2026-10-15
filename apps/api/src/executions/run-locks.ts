import { canCorrect } from '@taskop/contracts';
import { and, eq, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { DbService } from '../db/db.service';
import { executions, occurrences } from '../db/schema';
import type { ExecutionRow, OccurrenceRow } from './executions.service';

export interface LockedRun {
  e: ExecutionRow;
  o: OccurrenceRow;
}

/**
 * Locks a counted execution and its occurrence for a manager's or an auditor's change, in the order every execution
 * command uses: the occurrence, then the execution. Unknown, out of `scope` (SchedulingScope.occurrences) or a lost
 * claim (rejected) is 404 (Spec decision 26).
 */
export async function lockRun(db: DbService, scope: SQL | undefined, executionId: string): Promise<LockedRun> {
  const tx = db.tx();
  const [peek] = await tx.select({ occurrenceId: executions.occurrenceId, state: executions.state }).from(executions).where(eq(executions.id, executionId));
  if (!peek || peek.state === 'rejected') throw new AppError('NOT_FOUND');
  const [o] = await tx
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.id, peek.occurrenceId), scope))
    .for('update');
  if (!o) throw new AppError('NOT_FOUND');
  const [e] = await tx.select().from(executions).where(eq(executions.id, executionId)).for('update');
  return { e: e!, o };
}

/** Spec §3.1: an audited run is locked; anything else canCorrect refuses is not correctable. */
export function assertCorrectable(run: LockedRun): void {
  if (run.o.status === 'audited') throw new AppError('EXECUTION_LOCKED');
  if (!canCorrect({ status: run.o.status, executionState: run.e.state })) throw new AppError('EXECUTION_NOT_CORRECTABLE');
}

/** The original_* columns, written by the first correction or send-back only; the trigger refuses any later change. */
export function snapshotColumns(e: ExecutionRow, now: Date): Partial<Pick<ExecutionRow, 'originalAnswers' | 'originalScore' | 'originalCapturedAt'>> {
  return e.originalCapturedAt ? {} : { originalAnswers: e.answers, originalScore: e.score, originalCapturedAt: now };
}

import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, computeScore, type ExecutionProgress, progress, type ScoreResult } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executions } from '../db/schema';
import type { ExecutionRow, OccurrenceRow } from './executions.service';
import { ProblemWriter } from './problem-writer';

export interface RecalcInput {
  execution: ExecutionRow;
  occurrence: OccurrenceRow;
  /** The pinned version's content. */
  content: ChecklistContent;
  /** The answers just stored. */
  answers: Answers;
  /** Item id → the correction row that changed it, for cleared_by_correction_id. */
  clearedBy: ReadonlyMap<string, string>;
  now: Date;
}

/**
 * SP8 spec §6.3, shared by corrections and resubmits, in the caller's transaction: the score and progress from the
 * answers, then the problems after close. `completed_at`, `late` and the occurrence are never touched.
 */
@Injectable()
export class ExecutionRecalculator {
  constructor(
    private readonly db: DbService,
    private readonly problems: ProblemWriter,
  ) {}

  async recalculate(input: RecalcInput): Promise<{ score: ScoreResult; progress: ExecutionProgress }> {
    const { execution: e, occurrence: o, content, answers, clearedBy, now } = input;
    const score = computeScore(content, answers);
    const prog = progress(content, answers);
    await this.db.tx().update(executions).set({ score, progress: prog, updatedAt: now }).where(eq(executions.id, e.id));
    await this.problems.rewriteAfterClose(e, o, content, answers, clearedBy, now);
    return { score, progress: prog };
  }
}

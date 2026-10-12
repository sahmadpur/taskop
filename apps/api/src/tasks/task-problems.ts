import { Injectable } from '@nestjs/common';
import type { ProblemDto } from '@taskop/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';
import { type ProblemRow, selectProblemRows, toProblemDtos } from '../executions/problem-rows';
import { SchedulingScope } from '../scheduling/scheduling-scope';

/** The source problems of tasks (spec §6.2). Reads through executions/problem-rows, never through ExecutionsModule. */
@Injectable()
export class TaskProblems {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  /** Problem cards for task details: shown to whoever can read the task. */
  async cards(problemIds: string[]): Promise<Map<string, ProblemDto>> {
    if (!problemIds.length) return new Map();
    const tx = this.db.tx();
    const dtos = await toProblemDtos(tx, await selectProblemRows(tx).where(inArray(executionProblems.id, problemIds)));
    return new Map(dtos.map((d) => [d.id, d]));
  }

  /** A problem readable as GET /problems decides (spec Decision 6): assignments.view and the occurrence in scope. */
  async readable(p: Principal, problemId: string): Promise<ProblemRow | null> {
    if (!p.permissions.has('assignments.view')) return null;
    const [row] = await selectProblemRows(this.db.tx()).where(and(eq(executionProblems.id, problemId), this.scope.occurrences(p)));
    return row ?? null;
  }
}

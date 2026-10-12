import { Injectable } from '@nestjs/common';
import type { ProblemDto } from '@taskop/contracts';
import { inArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';
import { selectProblemRows, toProblemDtos } from '../executions/problem-rows';

/** The source problems of tasks (spec §6.2). Reads through executions/problem-rows, never through ExecutionsModule. */
@Injectable()
export class TaskProblems {
  constructor(private readonly db: DbService) {}

  /** Problem cards for task details: shown to whoever can read the task. */
  async cards(problemIds: string[]): Promise<Map<string, ProblemDto>> {
    if (!problemIds.length) return new Map();
    const tx = this.db.tx();
    const dtos = await toProblemDtos(tx, await selectProblemRows(tx).where(inArray(executionProblems.id, problemIds)));
    return new Map(dtos.map((d) => [d.id, d]));
  }
}

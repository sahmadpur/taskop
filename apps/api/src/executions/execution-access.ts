import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';

/** Who may read an execution and its media (spec §6.7, §6.8). No new permission key. */
@Injectable()
export class ExecutionAccess {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  /** The executor, or an assignments.view holder whose data scope covers the occurrence; anyone else gets 404. */
  async assertCanRead(p: Principal, executorUserId: string, occurrenceId: string): Promise<void> {
    if (p.userId === executorUserId) return;
    if (p.permissions.has('assignments.view')) {
      const [o] = await this.db
        .tx()
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(and(eq(occurrences.id, occurrenceId), this.scope.occurrences(p)));
      if (o) return;
    }
    throw new AppError('NOT_FOUND');
  }
}

import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';

const READ_KEYS = ['assignments.view', 'reports.view', 'audits.perform', 'executions.correct'] as const satisfies readonly PermissionKey[];

/** Who may read an execution, its media and its correction history (spec §6.7, §6.8, SP8 spec §6.2). */
@Injectable()
export class ExecutionAccess {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  /**
   * The executor, or a holder of assignments.view, reports.view (SP7 spec §5.6), audits.perform or executions.correct
   * (SP8 spec §5) whose data scope covers the occurrence; anyone else gets 404.
   */
  async assertCanRead(p: Principal, executorUserId: string, occurrenceId: string): Promise<void> {
    if (p.userId === executorUserId) return;
    if (READ_KEYS.some((k) => p.permissions.has(k))) {
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

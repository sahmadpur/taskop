import { Injectable } from '@nestjs/common';
import { FINAL_TASK_STATUSES, type SyncTask, TASK_LIMITS } from '@taskop/contracts';
import { and, asc, eq, gte, inArray, isNull, notInArray, or } from 'drizzle-orm';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { tasks } from '../db/schema';
import { TaskQueries } from './task-queries';
import { TaskScope } from './task-scope';

const DAY = 86_400_000;
const final = [...FINAL_TASK_STATUSES];
const open = () => notInArray(tasks.status, final);

/** The tasks section of GET /me/sync (spec §6.4). The sync has no change cursor: this is the complete set. */
@Injectable()
export class TaskSync {
  constructor(
    private readonly db: DbService,
    private readonly scope: TaskScope,
    private readonly queries: TaskQueries,
  ) {}

  /**
   * Open tasks assigned to the user, unaccepted open tasks of the user's active teams, and the user's tasks closed in
   * the last 7 days. Tasks awaiting someone's review come from GET /tasks. `removedTaskIds`: known ids not in the set.
   */
  async forUser(p: Principal, knownTaskIds: string[], now: Date): Promise<{ tasks: SyncTask[]; removedTaskIds: string[] }> {
    const since = new Date(+now - TASK_LIMITS.syncClosedDays * DAY);
    const rows = await this.db
      .tx()
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        or(
          and(eq(tasks.assigneeUserId, p.userId), open()),
          and(isNull(tasks.assigneeUserId), open(), this.scope.memberOfTeam(p.userId)),
          and(eq(tasks.assigneeUserId, p.userId), inArray(tasks.status, final), gte(tasks.updatedAt, since)),
        ),
      )
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
    const ids = rows.map((r) => r.id);
    const included = new Set(ids);
    return { tasks: await this.queries.syncTasks(ids), removedTaskIds: knownTaskIds.filter((id) => !included.has(id)) };
  }
}

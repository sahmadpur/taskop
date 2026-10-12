import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { DbService } from '../db/db.service';
import { tasks } from '../db/schema';
import { chain, inSubtree } from '../scheduling/scheduling-scope';

export type TaskRow = typeof tasks.$inferSelect;

export interface TaskAccess {
  canRead: boolean;
  canManage: boolean;
  canReview: boolean;
}

/**
 * THE team-membership predicate (ruling R6): a user_teams row of an active team (spec §6.4 "their active teams").
 * Read rule 2, the worker commands and the sync all use it; do not write a second copy.
 */
export const activeTeamMember = (userId: string, teamId: AnyPgColumn | SQL): SQL =>
  sql`exists (select 1 from user_teams ut join teams tm on tm.id = ut.team_id where ut.team_id = ${teamId} and ut.user_id = ${userId} and tm.active)`;

/** Spec §6.1 as SQL over `tasks`. Anything not readable is a 404. */
@Injectable()
export class TaskScope {
  constructor(
    private readonly db: DbService,
    private readonly users: ScopeService,
  ) {}

  /** Rule 3: the data scope covers the task. Callers check tasks.view / tasks.manage first. Unknown scopes fail closed. */
  covers(p: Principal): SQL {
    switch (p.dataScope) {
      case 'all':
        return sql`true`;
      case 'site_subtree':
        return sql`(${inSubtree(p.userId, tasks.siteId)} or exists (select 1 from users where users.id = ${tasks.assigneeUserId} and ${this.users.usersFilter(p)!}))`;
      case 'subordinates':
        return sql`${tasks.assigneeUserId} in ${chain(p.userId)}`;
      case 'own':
        return sql`false`;
      default: {
        const unhandled: never = p.dataScope;
        throw new Error(`Unhandled data scope: ${String(unhandled)}`);
      }
    }
  }

  /** The user is a member of the task's (active) team. */
  memberOfTeam(userId: string): SQL {
    return activeTeamMember(userId, tasks.assigneeTeamId);
  }

  /** Rules 1–3: creator, assignee, member of an unaccepted team task, or tasks.view / tasks.manage within scope. */
  readable(p: Principal): SQL {
    const view = p.permissions.has('tasks.view') || p.permissions.has('tasks.manage');
    return or(eq(tasks.createdByUserId, p.userId), eq(tasks.assigneeUserId, p.userId), and(isNull(tasks.assigneeUserId), this.memberOfTeam(p.userId)), view ? this.covers(p) : undefined)!;
  }

  /** tasks.manage, and the creator or within scope. */
  manageable(p: Principal): SQL {
    return p.permissions.has('tasks.manage') ? or(eq(tasks.createdByUserId, p.userId), this.covers(p))! : sql`false`;
  }

  /** The creator, or anyone who can manage the task. */
  reviewable(p: Principal): SQL {
    return or(eq(tasks.createdByUserId, p.userId), this.manageable(p))!;
  }

  async access(p: Principal, id: string): Promise<TaskAccess> {
    const [r] = await this.db
      .tx()
      .select({
        canRead: sql<boolean>`(${this.readable(p)})`,
        canManage: sql<boolean>`(${this.manageable(p)})`,
        canReview: sql<boolean>`(${this.reviewable(p)})`,
      })
      .from(tasks)
      .where(eq(tasks.id, id));
    return r ?? { canRead: false, canManage: false, canReview: false };
  }

  /** Locks the task row first: every command decides access after the lock, so it sees the committed state. */
  async lock(id: string): Promise<TaskRow> {
    const [t] = await this.db.tx().select().from(tasks).where(eq(tasks.id, id)).for('update');
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  /**
   * Who may manage a locked task: its creator, or a reader with tasks.manage over it. A reader who cannot manage gets
   * 403, anyone else 404.
   */
  async assertManage(p: Principal, t: TaskRow): Promise<void> {
    if (t.createdByUserId === p.userId) return;
    const a = await this.access(p, t.id);
    if (!a.canRead) throw new AppError('NOT_FOUND');
    if (!a.canManage) throw new AppError('FORBIDDEN');
  }

  /**
   * Who may run a worker command on a locked task (spec Decision 8): the assignee, or a team member while nobody
   * has accepted. A member who lost the race gets TASK_ALREADY_TAKEN, other readers 403, everyone else 404.
   */
  async assertWorker(p: Principal, t: TaskRow): Promise<void> {
    if (t.assigneeUserId === p.userId) return;
    const member = t.assigneeTeamId !== null && (await this.isActiveTeamMember(p.userId, t));
    if (member && t.assigneeUserId === null) return;
    if (member) throw new AppError('TASK_ALREADY_TAKEN');
    if ((await this.access(p, t.id)).canRead) throw new AppError('FORBIDDEN');
    throw new AppError('NOT_FOUND');
  }

  private async isActiveTeamMember(userId: string, t: TaskRow): Promise<boolean> {
    const [r] = await this.db
      .tx()
      .select({ member: sql<boolean>`(${activeTeamMember(userId, tasks.assigneeTeamId)})` })
      .from(tasks)
      .where(eq(tasks.id, t.id));
    return r?.member === true;
  }
}

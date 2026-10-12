import { Injectable } from '@nestjs/common';
import type { TaskAssignee, TaskAssigneeOptions } from '@taskop/contracts';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { escapeLike } from '../common/sql';
import { DbService } from '../db/db.service';
import { sites, teams, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';

const activeMembers = sql<number>`(select count(*)::int from user_teams ut join users u on u.id = ut.user_id where ut.team_id = "teams"."id" and u.status = 'active')`;
const invalid = () => new AppError('TASK_ASSIGNEE_INVALID', { fields: { assignee: 'errors.TASK_ASSIGNEE_INVALID' } });

/** Spec §6.1 "Assignable". Site membership is not required. */
@Injectable()
export class TaskAssignees {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly siteScope: SchedulingScope,
  ) {}

  /** A user: active and within the caller's users scope. A team: active, with at least one active member. */
  async resolve(p: Principal, a: TaskAssignee): Promise<{ userId: string | null; teamId: string | null }> {
    const tx = this.db.tx();
    if ('userId' in a) {
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, a.userId), eq(users.status, 'active'), this.scope.usersFilter(p)));
      if (!u) throw invalid();
      return { userId: u.id, teamId: null };
    }
    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, a.teamId), eq(teams.active, true), sql`${activeMembers} > 0`));
    if (!team) throw invalid();
    return { userId: null, teamId: team.id };
  }

  /** GET /tasks/assignees: up to 50 people and 50 teams, by name and filtered by `q`; up to 200 sites (Spec decision 25). */
  async options(p: Principal, q: string | undefined): Promise<TaskAssigneeOptions> {
    const tx = this.db.tx();
    const like = q ? `%${escapeLike(q)}%` : null;
    const people = await tx
      .select({ id: users.id, fullName: users.fullName, jobTitle: users.jobTitle, kind: users.kind })
      .from(users)
      .where(and(eq(users.status, 'active'), this.scope.usersFilter(p), like ? ilike(users.fullName, like) : undefined))
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(50);
    const groups = await tx
      .select({ id: teams.id, name: teams.name, memberCount: activeMembers })
      .from(teams)
      .where(and(eq(teams.active, true), sql`${activeMembers} > 0`, like ? ilike(teams.name, like) : undefined))
      .orderBy(asc(teams.name), asc(teams.id))
      .limit(50);
    // The sites a create or edit accepts: active and writable in the caller's scope. Not narrowed by `q`.
    const places = await tx
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.active, true), this.siteScope.writableSites(p)))
      .orderBy(asc(sites.name), asc(sites.id))
      .limit(200);
    return { users: people, teams: groups, sites: places };
  }
}

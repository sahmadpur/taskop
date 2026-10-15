import { Injectable } from '@nestjs/common';
import type { NotificationRuleDto } from '@taskop/contracts';
import { and, asc, eq, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import { ScopeService } from '../common/scope.service';
import { DbService } from '../db/db.service';
import { assignments, occurrenceAssignees, occurrences, sites, tasks, teams, users, userSites, userTeams } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { TaskScope } from '../tasks/task-scope';
import type { ManualTarget, RuleTarget, TaskTarget } from './notification-targets';
import { type ScopeSubject, ScopeSubjects } from './scope-subjects';

/** Spec §3.3, and the manual-message expansion of spec §6.4. Runs in the current tenant transaction. */
@Injectable()
export class NotificationRecipients {
  constructor(
    private readonly db: DbService,
    private readonly subjects: ScopeSubjects,
    private readonly scheduling: SchedulingScope,
    private readonly taskScope: TaskScope,
    private readonly scope: ScopeService,
  ) {}

  /** Direct audience ∪ role audience in scope; active users only; the actor removed; one entry per user, by id. */
  async resolve(rule: NotificationRuleDto, target: RuleTarget, actorUserId: string | null): Promise<string[]> {
    const ids = new Set<string>([...(await this.direct(rule, target)), ...(await this.byRole(rule.roleIds, target))]);
    if (actorUserId) ids.delete(actorUserId);
    return this.activeOnly([...ids]);
  }

  /** A manual message at fan-out: expanded again with the sender's current scope (Spec decision 12). */
  async forMessage(target: ManualTarget): Promise<string[]> {
    if (!target.senderUserId) return [];
    const sender = await this.subjects.forUser(target.senderUserId);
    return sender ? this.expandMessage(sender, target) : [];
  }

  /**
   * Selected users ∪ members of selected active teams ∪ users attached to a selected site or any site below it;
   * then active users inside the sender's users scope, minus the sender. Sorted by id.
   */
  async expandMessage(sender: ScopeSubject, t: { userIds: string[]; teamIds: string[]; siteIds: string[] }): Promise<string[]> {
    const tx = this.db.tx();
    const via: SQL[] = [];
    if (t.userIds.length) via.push(inArray(users.id, t.userIds));
    if (t.teamIds.length) {
      via.push(
        inArray(
          users.id,
          tx
            .select({ id: userTeams.userId })
            .from(userTeams)
            .innerJoin(teams, eq(teams.id, userTeams.teamId))
            .where(and(inArray(userTeams.teamId, t.teamIds), eq(teams.active, true))),
        ),
      );
    }
    if (t.siteIds.length) {
      via.push(
        inArray(
          users.id,
          tx
            .select({ id: userSites.userId })
            .from(userSites)
            .innerJoin(sites, eq(sites.id, userSites.siteId))
            .where(sql`exists (select 1 from sites sel where ${inArray(sql`sel.id`, t.siteIds)} and ${sites.path} <@ sel.path)`),
        ),
      );
    }
    if (!via.length) return [];
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, 'active'), ne(users.id, sender.userId), this.scope.usersFilter(sender), or(...via)))
      .orderBy(asc(users.id));
    return rows.map((r) => r.id);
  }

  private async direct(rule: NotificationRuleDto, target: RuleTarget): Promise<string[]> {
    switch (target.kind) {
      case 'assignment':
        return rule.notifyAssignees ? target.addedUserIds : [];
      case 'occurrence': {
        if (!rule.notifyAssignees) return [];
        const rows = await this.db
          .tx()
          .select({ id: occurrenceAssignees.userId })
          .from(occurrenceAssignees)
          .where(eq(occurrenceAssignees.occurrenceId, target.occurrenceId));
        return rows.map((r) => r.id);
      }
      case 'problem':
        return [];
      case 'task':
        return [...(rule.notifyAssignees ? await this.taskAssignees(target) : []), ...(rule.notifyCreator ? [target.createdByUserId] : [])];
      case 'run':
        // Spec decision 16: "assignees" is the executor; "creator" is whoever sent the run back.
        return [...(rule.notifyAssignees ? [target.executorUserId] : []), ...(rule.notifyCreator && target.sentBackByUserId ? [target.sentBackByUserId] : [])];
      default: {
        const unhandled: never = target;
        throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** The assignee, or while nobody has accepted, the members of the task's active team. */
  private async taskAssignees(t: TaskTarget): Promise<string[]> {
    if (t.assigneeUserId) return [t.assigneeUserId];
    if (!t.assigneeTeamId) return [];
    const rows = await this.db
      .tx()
      .select({ id: userTeams.userId })
      .from(userTeams)
      .innerJoin(teams, eq(teams.id, userTeams.teamId))
      .where(and(eq(userTeams.teamId, t.assigneeTeamId), eq(teams.active, true)));
    return rows.map((r) => r.id);
  }

  private async byRole(roleIds: string[], target: RuleTarget): Promise<string[]> {
    const out: string[] = [];
    for (const s of await this.subjects.holdersOf(roleIds)) if (await this.sees(s, target)) out.push(s.userId);
    return out;
  }

  /** Spec §3.3 rule 2 with Spec decisions 2–3: the role's permission, then the existing scope SQL for that user. */
  private async sees(s: ScopeSubject, target: RuleTarget): Promise<boolean> {
    const tx = this.db.tx();
    switch (target.kind) {
      case 'occurrence':
      case 'problem': {
        if (!s.permissions.has('assignments.view')) return false;
        const id = target.kind === 'occurrence' ? target.occurrenceId : target.occurrence.occurrenceId;
        const [r] = await tx.select({ id: occurrences.id }).from(occurrences).where(and(eq(occurrences.id, id), this.scheduling.occurrences(s)));
        return r !== undefined;
      }
      case 'assignment': {
        if (!s.permissions.has('assignments.view')) return false;
        const [r] = await tx.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.id, target.assignmentId), this.scheduling.assignments(s)));
        return r !== undefined;
      }
      case 'task': {
        if (!s.permissions.has('tasks.view') && !s.permissions.has('tasks.manage')) return false;
        const [r] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, target.taskId), this.taskScope.readable(s)));
        return r !== undefined;
      }
      case 'run': {
        if (!(['assignments.view', 'reports.view', 'audits.perform', 'executions.correct'] as const).some((k) => s.permissions.has(k))) return false;
        const [r] = await tx.select({ id: occurrences.id }).from(occurrences).where(and(eq(occurrences.id, target.occurrence.occurrenceId), this.scheduling.occurrences(s)));
        return r !== undefined;
      }
      default: {
        const unhandled: never = target;
        throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async activeOnly(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .tx()
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.status, 'active')))
      .orderBy(asc(users.id));
    return rows.map((r) => r.id);
  }
}

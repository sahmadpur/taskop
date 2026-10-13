import { Injectable } from '@nestjs/common';
import type { NotificationType, ProblemSeverity } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { assignments, checklists, executionProblems, occurrences, sites, tasks, tenants } from '../db/schema';
import type { AssignedPayload, ManualPayload, OccurrencePayload, ProblemPayload, TaskPayload } from './payloads';

export interface OccurrenceTarget {
  kind: 'occurrence';
  occurrenceId: string;
  assignmentId: string;
  localDate: string;
  startsAt: Date;
  dueAt: Date;
  checklistName: string;
  siteName: string;
  /** The tenant's timezone, for times in texts. */
  timezone: string;
}

export interface ProblemTarget {
  kind: 'problem';
  problemId: string;
  severity: ProblemSeverity;
  note: string | null;
  occurrence: OccurrenceTarget;
}

export interface AssignmentTarget {
  kind: 'assignment';
  assignmentId: string;
  addedUserIds: string[];
  checklistName: string;
  siteName: string;
}

export interface TaskTarget {
  kind: 'task';
  taskId: string;
  title: string;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  createdByUserId: string;
  dueAt: Date | null;
  timezone: string;
}

export type ManualTarget = ManualPayload & { kind: 'manual'; senderUserId: string | null };

export type RuleTarget = OccurrenceTarget | ProblemTarget | AssignmentTarget | TaskTarget;
export type NotificationTarget = RuleTarget | ManualTarget;

/** Spec §6.1 step 4: what an event is about, read in the fan-out's tenant transaction. Null when it no longer exists. */
@Injectable()
export class NotificationTargets {
  constructor(private readonly db: DbService) {}

  async load(type: NotificationType, payload: unknown, actorUserId: string | null): Promise<NotificationTarget | null> {
    if (type === 'manual') return { kind: 'manual', ...(payload as ManualPayload), senderUserId: actorUserId };
    if (type === 'checklist.assigned') return this.assignment(payload as AssignedPayload);
    if (type.startsWith('checklist.')) return this.occurrence((payload as OccurrencePayload).occurrenceId);
    if (type.startsWith('problem.')) return this.problem(payload as ProblemPayload);
    return this.task((payload as TaskPayload).taskId);
  }

  private async timezone(): Promise<string> {
    const [t] = await this.db.tx().select({ timezone: tenants.timezone }).from(tenants);
    return t?.timezone ?? 'Asia/Baku';
  }

  private async occurrence(occurrenceId: string): Promise<OccurrenceTarget | null> {
    const [r] = await this.db
      .tx()
      .select({
        id: occurrences.id,
        assignmentId: occurrences.assignmentId,
        localDate: occurrences.localDate,
        startsAt: occurrences.startsAt,
        dueAt: occurrences.dueAt,
        checklistName: checklists.name,
        siteName: sites.name,
      })
      .from(occurrences)
      .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
      .innerJoin(sites, eq(sites.id, occurrences.siteId))
      .where(eq(occurrences.id, occurrenceId));
    if (!r) return null;
    return {
      kind: 'occurrence',
      occurrenceId: r.id,
      assignmentId: r.assignmentId,
      localDate: r.localDate,
      startsAt: r.startsAt,
      dueAt: r.dueAt,
      checklistName: r.checklistName,
      siteName: r.siteName,
      timezone: await this.timezone(),
    };
  }

  /** A problem a later answers sync deleted is gone, even though its occurrence stays. */
  private async problem(p: ProblemPayload): Promise<ProblemTarget | null> {
    const [r] = await this.db
      .tx()
      .select({ id: executionProblems.id, severity: executionProblems.severity, note: executionProblems.note })
      .from(executionProblems)
      .where(eq(executionProblems.id, p.problemId));
    if (!r) return null;
    const occurrence = await this.occurrence(p.occurrenceId);
    return occurrence ? { kind: 'problem', problemId: r.id, severity: r.severity, note: r.note, occurrence } : null;
  }

  private async assignment(p: AssignedPayload): Promise<AssignmentTarget | null> {
    const [r] = await this.db
      .tx()
      .select({ id: assignments.id, checklistName: checklists.name, siteName: sites.name })
      .from(assignments)
      .innerJoin(checklists, eq(checklists.id, assignments.checklistId))
      .innerJoin(sites, eq(sites.id, assignments.siteId))
      .where(eq(assignments.id, p.assignmentId));
    return r ? { kind: 'assignment', assignmentId: r.id, addedUserIds: p.addedUserIds, checklistName: r.checklistName, siteName: r.siteName } : null;
  }

  private async task(taskId: string): Promise<TaskTarget | null> {
    const [r] = await this.db
      .tx()
      .select({
        id: tasks.id,
        title: tasks.title,
        assigneeUserId: tasks.assigneeUserId,
        assigneeTeamId: tasks.assigneeTeamId,
        createdByUserId: tasks.createdByUserId,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!r) return null;
    return { kind: 'task', taskId: r.id, title: r.title, assigneeUserId: r.assigneeUserId, assigneeTeamId: r.assigneeTeamId, createdByUserId: r.createdByUserId, dueAt: r.dueAt, timezone: await this.timezone() };
  }
}

import { Injectable } from '@nestjs/common';
import { type AuditResult, type AuditScore, isAuditType, type NotificationType, type ProblemSeverity, type ReworkItem } from '@taskop/contracts';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { assignments, audits, checklists, executionProblems, executionReworkRequests, executions, occurrences, sites, tasks, tenants, users } from '../db/schema';
import type { AssignedPayload, ManualPayload, OccurrencePayload, ProblemPayload, RunPayload, TaskPayload } from './payloads';

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

/** SP8: a run sent back, resubmitted or audited. Opens the run like checklist notifications do. */
export interface RunTarget {
  kind: 'run';
  occurrence: OccurrenceTarget;
  executionId: string;
  executorUserId: string;
  executorName: string;
  round: number | null;
  /** Items of the send-back round. */
  flaggedCount: number;
  dueAt: Date | null;
  /** Who sent the run back: run.resubmitted's "creator" audience. */
  sentBackByUserId: string | null;
  auditResult: AuditResult | null;
  auditPercent: number | null;
}

export type ManualTarget = ManualPayload & { kind: 'manual'; senderUserId: string | null };

export type RuleTarget = OccurrenceTarget | ProblemTarget | AssignmentTarget | TaskTarget | RunTarget;
export type NotificationTarget = RuleTarget | ManualTarget;

/** Spec §6.1 step 4: what an event is about, read in the fan-out's tenant transaction. Null when it no longer exists. */
@Injectable()
export class NotificationTargets {
  constructor(private readonly db: DbService) {}

  async load(type: NotificationType, payload: unknown, actorUserId: string | null): Promise<NotificationTarget | null> {
    if (type === 'manual') return { kind: 'manual', ...(payload as ManualPayload), senderUserId: actorUserId };
    if (isAuditType(type)) return this.run(payload as RunPayload);
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

  private async run(p: RunPayload): Promise<RunTarget | null> {
    const occurrence = await this.occurrence(p.occurrenceId);
    if (!occurrence) return null;
    const tx = this.db.tx();
    const [x] = await tx
      .select({ executorUserId: executions.executorUserId, executorName: users.fullName })
      .from(executions)
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .where(eq(executions.id, p.executionId));
    if (!x) return null;
    const [request] =
      p.round === undefined
        ? []
        : await tx
            .select({ items: executionReworkRequests.items, dueAt: executionReworkRequests.dueAt, by: executionReworkRequests.requestedByUserId })
            .from(executionReworkRequests)
            .where(and(eq(executionReworkRequests.executionId, p.executionId), eq(executionReworkRequests.round, p.round)));
    const [audit] = p.auditId ? await tx.select({ result: audits.result, score: audits.auditScore }).from(audits).where(eq(audits.id, p.auditId)) : [];
    return {
      kind: 'run',
      occurrence,
      executionId: p.executionId,
      executorUserId: x.executorUserId,
      executorName: x.executorName,
      round: p.round ?? null,
      flaggedCount: request ? (request.items as ReworkItem[]).length : 0,
      dueAt: request?.dueAt ?? null,
      sentBackByUserId: request?.by ?? null,
      auditResult: audit?.result ?? null,
      auditPercent: (audit?.score as AuditScore | null | undefined)?.percent ?? null,
    };
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

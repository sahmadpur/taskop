import { Injectable } from '@nestjs/common';
import type { SyncTask, TaskDetail, TaskEvidence, TaskHistoryEntry } from '@taskop/contracts';
import { asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { taskMedia, taskStatusHistory, taskSubmissions, tasks, users } from '../db/schema';
import { TaskProblems } from './task-problems';
import { iso, selectTasks, toHistoryEntry, toSubmissionDto, toTaskMediaDto, toTaskSummary } from './task-rows';
import { TaskScope } from './task-scope';

const submitter = alias(users, 'submitter');
const reviewer = alias(users, 'reviewer');

/** GET /tasks/:id and the phone's copies (spec §6.2, §6.4). */
@Injectable()
export class TaskQueries {
  constructor(
    private readonly db: DbService,
    private readonly scope: TaskScope,
    private readonly problems: TaskProblems,
  ) {}

  async detail(p: Principal, id: string): Promise<TaskDetail> {
    const access = await this.scope.access(p, id);
    if (!access.canRead) throw new AppError('NOT_FOUND');
    const [task] = await this.syncTasks([id]);
    return { ...task!, history: await this.history(id), canManage: access.canManage, canReview: access.canReview };
  }

  /** Everything but history and rights, batched; the result keeps the order of `ids`. Callers check access. */
  async syncTasks(ids: string[]): Promise<SyncTask[]> {
    if (!ids.length) return [];
    const tx = this.db.tx();
    const rows = await selectTasks(tx).where(inArray(tasks.id, ids));
    const media = await tx
      .select({ m: getTableColumns(taskMedia), capturedByName: users.fullName })
      .from(taskMedia)
      .innerJoin(users, eq(users.id, taskMedia.capturedByUserId))
      .where(inArray(taskMedia.taskId, ids))
      .orderBy(asc(taskMedia.capturedAt), asc(taskMedia.id));
    const submissions = await tx
      .select({ s: getTableColumns(taskSubmissions), submittedByName: submitter.fullName, reviewedByName: reviewer.fullName })
      .from(taskSubmissions)
      .innerJoin(submitter, eq(submitter.id, taskSubmissions.submittedByUserId))
      .leftJoin(reviewer, eq(reviewer.id, taskSubmissions.reviewedByUserId))
      .where(inArray(taskSubmissions.taskId, ids))
      .orderBy(asc(taskSubmissions.receivedAt), asc(taskSubmissions.id));
    const problems = await this.problems.cards(rows.flatMap((r) => (r.t.problemId ? [r.t.problemId] : [])));
    const byId = new Map<string, SyncTask>(
      rows.map((r) => [
        r.t.id,
        {
          ...toTaskSummary(r),
          instructions: r.t.instructions,
          evidence: r.t.evidence as TaskEvidence,
          acceptedAt: iso(r.t.acceptedAt),
          startedAt: iso(r.t.startedAt),
          submittedAt: iso(r.t.submittedAt),
          completedAt: iso(r.t.completedAt),
          cancelledAt: iso(r.t.cancelledAt),
          cancelReason: r.t.cancelReason,
          media: media.filter((m) => m.m.taskId === r.t.id).map(toTaskMediaDto),
          submissions: submissions.filter((s) => s.s.taskId === r.t.id).map(toSubmissionDto),
          problem: r.t.problemId ? (problems.get(r.t.problemId) ?? null) : null,
        },
      ]),
    );
    return ids.flatMap((id) => {
      const task = byId.get(id);
      return task ? [task] : [];
    });
  }

  private async history(taskId: string): Promise<TaskHistoryEntry[]> {
    const rows = await this.db
      .tx()
      .select({ h: getTableColumns(taskStatusHistory), actorName: users.fullName })
      .from(taskStatusHistory)
      .leftJoin(users, eq(users.id, taskStatusHistory.actorUserId))
      .where(eq(taskStatusHistory.taskId, taskId))
      .orderBy(asc(taskStatusHistory.at), asc(taskStatusHistory.id));
    return rows.map(toHistoryEntry);
  }
}

import { isFinalTaskStatus } from '@taskop/contracts';
import { isTaskOverdue, isTeamOffer, type TaskView } from '@/offline/task-store';

export const TASK_GROUP_KEYS = ['team', 'mine', 'inReview', 'done'] as const;
export type TaskGroupKey = (typeof TASK_GROUP_KEYS)[number];
export type TaskGroups = Record<TaskGroupKey, TaskView[]>;

const dueMs = (t: TaskView): number => (t.server.dueAt ? Date.parse(t.server.dueAt) : Number.POSITIVE_INFINITY);
/** By due date (none last), then by creation. Two tasks without a due date compare as NaN, which falls through. */
const byDue = (a: TaskView, b: TaskView): number => dueMs(a) - dueMs(b) || a.server.createdAt.localeCompare(b.server.createdAt);

/**
 * Spec §7.2: Komanda üçün (unaccepted team tasks), Mənim (overdue first, then by due date), Yoxlamada (awaiting review),
 * Tamamlanıb (completed or cancelled; /me/sync keeps them 7 days), newest first.
 */
export function groupTasks(tasks: readonly TaskView[], now: number): TaskGroups {
  const groups: TaskGroups = { team: [], mine: [], inReview: [], done: [] };
  for (const t of tasks) {
    if (isTeamOffer(t)) groups.team.push(t);
    else if (isFinalTaskStatus(t.status)) groups.done.push(t);
    else if (t.status === 'awaiting_review') groups.inReview.push(t);
    else groups.mine.push(t);
  }
  groups.team.sort(byDue);
  groups.mine.sort((a, b) => Number(isTaskOverdue(b, now)) - Number(isTaskOverdue(a, now)) || byDue(a, b));
  groups.inReview.sort(byDue);
  groups.done.sort((a, b) => b.server.updatedAt.localeCompare(a.server.updatedAt));
  return groups;
}

/** The Home card (decision 14): my open tasks (Mənim) and how many of them are overdue. */
export function taskCounts(groups: TaskGroups, now: number): { open: number; overdue: number } {
  return { open: groups.mine.length, overdue: groups.mine.filter((t) => isTaskOverdue(t, now)).length };
}

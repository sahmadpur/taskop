import {
  addDays,
  isFinalTaskStatus,
  localDateOf,
  minutesToTime,
  type ProblemResolution,
  TASK_HISTORY_REASONS,
  TASK_STATUSES,
  type TaskListQuery,
  type TaskSource,
  type TaskStatus,
  type TaskSummary,
  timeToMinutes,
  tzOffsetMinutes,
  zonedTimeToUtc,
} from '@taskop/contracts';
import type { TFunction } from 'i18next';
import type { Variant } from '@/features/scheduling/labels';

export const OPEN_TASK_STATUSES = TASK_STATUSES.filter((s) => !isFinalTaskStatus(s));

export const taskStatusVariant = (s: TaskStatus): Variant => (s === 'completed' ? 'default' : s === 'cancelled' ? 'outline' : s === 'new' ? 'outline' : 'secondary');

export const resolutionVariant = (r: ProblemResolution): Variant => (r === 'resolved' ? 'default' : r === 'open' ? 'warning' : 'outline');

/** A due date without a time means "by the end of that day". */
export const END_OF_DAY = '23:59';

/** A tenant-local date and time as an instant. Never the browser's zone: the tenant's (spec §8). */
export function dueAtFromLocal(date: string, time: string, timeZone: string): string | null {
  if (!date) return null;
  return zonedTimeToUtc(date, timeToMinutes(time || END_OF_DAY), timeZone).toISOString();
}

/** The reverse of dueAtFromLocal, for the edit form. Seconds are dropped. */
export function localDueParts(iso: string | null, timeZone: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const at = new Date(iso);
  const wallMs = at.getTime() + tzOffsetMinutes(timeZone, at) * 60_000;
  return { date: localDateOf(at, timeZone), time: minutesToTime(Math.floor(wallMs / 60_000)) };
}

export type TaskTab = 'all' | 'review' | 'overdue' | 'mine';
export const TASK_TABS: readonly TaskTab[] = ['all', 'review', 'overdue', 'mine'];

/** A pick of the person-or-team picker; the name is only for display. */
export interface AssigneeChoice {
  type: 'user' | 'team';
  id: string;
  name: string;
}

export const sameChoice = (a: AssigneeChoice | null, b: AssigneeChoice | null): boolean => a?.type === b?.type && a?.id === b?.id;

export interface TaskFilters {
  status: TaskStatus | '';
  siteId: string;
  assignee: AssigneeChoice | null;
  source: TaskSource | '';
  /** Tenant-local dates, YYYY-MM-DD or ''. */
  dueFrom: string;
  dueTo: string;
}

export const EMPTY_TASK_FILTERS: TaskFilters = { status: '', siteId: '', assignee: null, source: '', dueFrom: '', dueTo: '' };

export const dueRangeInverted = (f: TaskFilters): boolean => Boolean(f.dueFrom && f.dueTo && f.dueTo < f.dueFrom);

/** The GET /tasks query of a tab plus the filters. A status filter replaces the tab's own status list. */
export function taskListQuery(tab: TaskTab, f: TaskFilters, ctx: { userId: string; timeZone: string }): TaskListQuery {
  const q: TaskListQuery = {};
  if (tab === 'review') q.awaitingMyReview = 'true';
  if (tab === 'overdue') {
    q.overdue = 'true';
    q.status = OPEN_TASK_STATUSES.join(',');
  }
  if (tab === 'mine') q.createdBy = ctx.userId;
  if (f.status) q.status = f.status;
  if (f.siteId) q.siteId = f.siteId;
  if (f.assignee?.type === 'user') q.assigneeUserId = f.assignee.id;
  if (f.assignee?.type === 'team') q.teamId = f.assignee.id;
  if (f.source) q.source = f.source;
  // Whole tenant-local days, both ends included.
  if (f.dueFrom) q.dueFrom = zonedTimeToUtc(f.dueFrom, 0, ctx.timeZone).toISOString();
  if (f.dueTo) q.dueTo = new Date(zonedTimeToUtc(addDays(f.dueTo, 1), 0, ctx.timeZone).getTime() - 1).toISOString();
  return q;
}

/** "Person", "Team (komanda)" while nobody accepted it, or "Person · Team" once a member did. */
export function assigneeText(t: TFunction, s: Pick<TaskSummary, 'assignee' | 'team'>): string {
  if (s.assignee && s.team) return `${s.assignee.fullName} · ${s.team.name}`;
  if (s.assignee) return s.assignee.fullName;
  return s.team ? t('tasks.page.teamWaiting', { team: s.team.name }) : '—';
}

/** System comments are TASK_HISTORY_REASONS codes (Part 1 decision 23); reviewers' comments and cancel reasons are free text. */
export const historyComment = (t: TFunction, comment: string | null): string | null =>
  comment !== null && (TASK_HISTORY_REASONS as readonly string[]).includes(comment) ? t(`tasks.historyReasons.${comment}`) : comment;

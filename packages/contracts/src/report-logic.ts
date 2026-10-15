import type { OccurrenceStatus } from './occurrences.js';
import { addDays, dayNumber, fromDayNumber, isoWeekday, type LocalDate } from './scheduling-time.js';

/**
 * Sub-project 7 spec §3: THE metric rules. apps/api/src/reports/report-queries.ts implements the same rules in SQL;
 * its cross-check test (reports-summary.test.ts) keeps the two equal. Change both together.
 */
export const RUN_COUNT_KEYS = ['planned', 'due', 'completed', 'inProgress', 'pending', 'overdue', 'partial', 'missed', 'withProblems', 'withCritical'] as const;
export type RunCountKey = (typeof RUN_COUNT_KEYS)[number];
export type RunCounts = Record<RunCountKey, number>;
export type RunFlags = Record<RunCountKey, boolean>;

export const COMPLETED_STATUSES = ['completed', 'audit_pending', 'audited', 'correction_required'] as const satisfies readonly OccurrenceStatus[];
export const IN_PROGRESS_STATUSES = ['started', 'in_progress'] as const satisfies readonly OccurrenceStatus[];

const isCompleted = (s: OccurrenceStatus): boolean => (COMPLETED_STATUSES as readonly OccurrenceStatus[]).includes(s);
const isInProgress = (s: OccurrenceStatus): boolean => (IN_PROGRESS_STATUSES as readonly OccurrenceStatus[]).includes(s);

export interface RunFacts {
  status: OccurrenceStatus;
  dueAt: Date | string;
  /** At least one execution_problems row for the occurrence. */
  hasProblems: boolean;
  /** At least one of them critical. */
  hasCritical: boolean;
}

/** The buckets a run falls into at instant `now` (spec §3.1). A cancelled run falls into none. */
export function classifyRun(run: RunFacts, now: Date): RunFlags {
  const planned = run.status !== 'cancelled';
  const completed = isCompleted(run.status);
  return {
    planned,
    // A run that finished before its due time is due too, so completion % never exceeds 100.
    due: planned && (completed || +new Date(run.dueAt) <= +now),
    completed,
    inProgress: isInProgress(run.status),
    pending: run.status === 'pending',
    overdue: run.status === 'overdue',
    partial: run.status === 'partial',
    missed: run.status === 'missed',
    withProblems: planned && run.hasProblems,
    withCritical: planned && run.hasCritical,
  };
}

export const emptyRunCounts = (): RunCounts => Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, 0])) as RunCounts;

export function tallyRuns(runs: readonly RunFacts[], now: Date): RunCounts {
  const counts = emptyRunCounts();
  for (const r of runs) {
    const flags = classifyRun(r, now);
    for (const k of RUN_COUNT_KEYS) if (flags[k]) counts[k]++;
  }
  return counts;
}

export const roundOne = (x: number): number => Math.round(x * 10) / 10;

/** Completed ÷ Due × 100, one decimal; null when nothing is due yet (shown as "—"). */
export const completionPercent = (completed: number, due: number): number | null => (due > 0 ? roundOne((completed / due) * 100) : null);

/** Mean of the scores that exist, one decimal; null when there are none. */
export function averageScore(values: readonly (number | null | undefined)[]): number | null {
  const scores = values.filter((v): v is number => typeof v === 'number');
  return scores.length ? roundOne(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

export interface AttributionFacts {
  status: OccurrenceStatus;
  /** The counted (non-rejected) execution's executor, or null when the run was never started. */
  executorUserId: string | null;
  /** The occurrence's assignee snapshot. */
  assigneeIds: readonly string[];
}

/**
 * Spec §3.3: who a run counts for in the employee table. An executed run belongs only to its executor; an unexecuted
 * run to every assignee; one with no assignees to the Unassigned row (`null`); a cancelled run to nobody.
 */
export function attributeRun(run: AttributionFacts): (string | null)[] {
  if (run.status === 'cancelled') return [];
  if (run.executorUserId) return [run.executorUserId];
  return run.assigneeIds.length ? [...run.assigneeIds] : [null];
}

/** The filter bar's presets (spec §6.1). "Custom" is a free range, not a preset. */
export const PERIOD_PRESETS = ['today', 'yesterday', 'this_week', 'this_month', 'last_7', 'last_30'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface Period {
  from: LocalDate;
  to: LocalDate;
}

/** A preset as a range ending at the tenant's `today` (Spec decision 4). Weeks start on Monday. */
export function resolvePeriod(preset: PeriodPreset, today: LocalDate): Period {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'this_week':
      return { from: addDays(today, 1 - isoWeekday(today)), to: today };
    case 'this_month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last_7':
      return { from: addDays(today, -6), to: today };
    case 'last_30':
      return { from: addDays(today, -29), to: today };
  }
}

/** Every calendar day from `from` to `to`, inclusive. Pure date arithmetic, so DST changes cannot drop or repeat a day. */
export function periodDays(from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n++) days.push(fromDayNumber(n));
  return days;
}

export const REPORT_LIMITS = {
  /** `to − from` at most 365, so a range covers at most 366 days (spec §3.2). */
  maxRangeDays: 366,
  /** Rows per page of /reports/runs, /reports/problems and /reports/tasks (spec §5.3). */
  pageSize: 50,
  /** Rows per list section of an export (spec §5.4). */
  exportRowCap: 10_000,
  /** The API's default statement timeout per report request (spec §5.5). */
  statementTimeoutMs: 15_000,
} as const;

/** True when the range is longer than REPORT_LIMITS.maxRangeDays: the API answers 400 REPORT_RANGE_TOO_LONG. */
export const reportRangeTooLong = (from: LocalDate, to: LocalDate): boolean => dayNumber(to) - dayNumber(from) > REPORT_LIMITS.maxRangeDays - 1;

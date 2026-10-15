import { describe, expect, it } from 'vitest';
import {
  attributeRun,
  averageScore,
  classifyRun,
  COMPLETED_STATUSES,
  completionPercent,
  emptyRunCounts,
  IN_PROGRESS_STATUSES,
  OCCURRENCE_STATUSES,
  type OccurrenceStatus,
  PERIOD_PRESETS,
  periodDays,
  REPORT_LIMITS,
  reportRangeTooLong,
  resolvePeriod,
  roundOne,
  RUN_COUNT_KEYS,
  type RunCountKey,
  tallyRuns,
} from './index.js';

const NOW = new Date('2026-11-04T08:00:00Z');
const PAST = '2026-11-04T06:00:00Z';
const FUTURE = '2026-11-04T12:00:00Z';
const run = (status: OccurrenceStatus, dueAt: string = PAST, hasProblems = false, hasCritical = false) => ({ status, dueAt, hasProblems, hasCritical });
const on = (...keys: RunCountKey[]) => Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, keys.includes(k)]));

describe('classifyRun (spec §3.1)', () => {
  it('puts every status in its buckets once its due time has passed', () => {
    const expected: Record<OccurrenceStatus, RunCountKey[]> = {
      pending: ['planned', 'due', 'pending'],
      started: ['planned', 'due', 'inProgress'],
      in_progress: ['planned', 'due', 'inProgress'],
      completed: ['planned', 'due', 'completed'],
      partial: ['planned', 'due', 'partial'],
      overdue: ['planned', 'due', 'overdue'],
      missed: ['planned', 'due', 'missed'],
      cancelled: [],
      audit_pending: ['planned', 'due', 'completed'],
      audited: ['planned', 'due', 'completed'],
      correction_required: ['planned', 'due', 'completed'],
    };
    for (const s of OCCURRENCE_STATUSES) expect(classifyRun(run(s), NOW), s).toEqual(on(...expected[s]));
  });

  it('counts a run as due only once its due time has passed, unless it is completed', () => {
    expect(classifyRun(run('pending', FUTURE), NOW).due).toBe(false);
    expect(classifyRun(run('in_progress', FUTURE), NOW).due).toBe(false);
    // Finished early: in the numerator and the denominator, so completion never exceeds 100%.
    expect(classifyRun(run('completed', FUTURE), NOW)).toMatchObject({ planned: true, due: true, completed: true });
    expect(classifyRun(run('audited', FUTURE), NOW)).toMatchObject({ due: true, completed: true });
    // Exactly at the due time is due.
    expect(classifyRun(run('pending', '2026-11-04T08:00:00Z'), NOW).due).toBe(true);
  });

  it('accepts the due time as a Date', () => {
    expect(classifyRun({ ...run('pending'), dueAt: new Date(FUTURE) }, NOW).due).toBe(false);
  });

  it('flags problems and critical problems, never on a cancelled run', () => {
    expect(classifyRun(run('completed', PAST, true, true), NOW)).toMatchObject({ withProblems: true, withCritical: true });
    expect(classifyRun(run('partial', PAST, true, false), NOW)).toMatchObject({ withProblems: true, withCritical: false });
    expect(classifyRun(run('cancelled', PAST, true, true), NOW)).toEqual(on());
  });

  it('names the status groups the SQL mirrors', () => {
    expect(COMPLETED_STATUSES).toEqual(['completed', 'audit_pending', 'audited', 'correction_required']);
    expect(IN_PROGRESS_STATUSES).toEqual(['started', 'in_progress']);
    expect(RUN_COUNT_KEYS).toEqual(['planned', 'due', 'completed', 'inProgress', 'pending', 'overdue', 'partial', 'missed', 'withProblems', 'withCritical']);
  });
});

describe('tallyRuns', () => {
  it('sums the flags of every run', () => {
    const c = tallyRuns([run('completed', FUTURE), run('completed'), run('missed'), run('pending', FUTURE), run('cancelled')], NOW);
    expect(c).toEqual({ ...emptyRunCounts(), planned: 4, due: 3, completed: 2, missed: 1, pending: 1 });
    expect(completionPercent(c.completed, c.due)).toBe(66.7);
  });

  it('is all zeros for no runs', () => {
    expect(tallyRuns([], NOW)).toEqual(emptyRunCounts());
    expect(Object.values(emptyRunCounts())).toEqual(RUN_COUNT_KEYS.map(() => 0));
  });
});

describe('percentages', () => {
  it('rounds completion to one decimal and is null with nothing due', () => {
    expect(completionPercent(0, 0)).toBeNull();
    expect(completionPercent(0, 3)).toBe(0);
    expect(completionPercent(7, 13)).toBe(53.8);
    expect(completionPercent(2, 3)).toBe(66.7);
    expect(completionPercent(4, 7)).toBe(57.1);
    expect(completionPercent(5, 5)).toBe(100);
  });

  it('averages the scores that exist', () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([null, undefined])).toBeNull();
    expect(averageScore([80, 100, 60, 90, 50, 70, 100, null])).toBe(78.6);
    expect(averageScore([0])).toBe(0);
  });

  it('rounds to one decimal', () => {
    expect(roundOne(12.34)).toBe(12.3);
    expect(roundOne(12.36)).toBe(12.4);
    expect(roundOne(100)).toBe(100);
  });
});

describe('attributeRun (spec §3.3)', () => {
  const [a, b, c] = ['user-a', 'user-b', 'user-c'];

  it('gives a shared run completed by one assignee to that person only', () => {
    expect(attributeRun({ status: 'completed', executorUserId: b, assigneeIds: [a, b, c] })).toEqual([b]);
  });

  it('gives a missed shared run to every assignee, once each', () => {
    expect(attributeRun({ status: 'missed', executorUserId: null, assigneeIds: [a, b, c] })).toEqual([a, b, c]);
  });

  it('gives an unassigned missed run to the Unassigned row', () => {
    expect(attributeRun({ status: 'missed', executorUserId: null, assigneeIds: [] })).toEqual([null]);
  });

  it('gives a partial or in-progress run to its executor and a cancelled run to nobody', () => {
    expect(attributeRun({ status: 'partial', executorUserId: a, assigneeIds: [a, b] })).toEqual([a]);
    expect(attributeRun({ status: 'started', executorUserId: b, assigneeIds: [a, b] })).toEqual([b]);
    expect(attributeRun({ status: 'cancelled', executorUserId: null, assigneeIds: [a] })).toEqual([]);
  });
});

describe('periods', () => {
  it('resolves every preset from the tenant’s today (a Wednesday)', () => {
    expect(PERIOD_PRESETS.map((p) => [p, resolvePeriod(p, '2026-11-04')])).toEqual([
      ['today', { from: '2026-11-04', to: '2026-11-04' }],
      ['yesterday', { from: '2026-11-03', to: '2026-11-03' }],
      ['this_week', { from: '2026-11-02', to: '2026-11-04' }],
      ['this_month', { from: '2026-11-01', to: '2026-11-04' }],
      ['last_7', { from: '2026-10-29', to: '2026-11-04' }],
      ['last_30', { from: '2026-10-06', to: '2026-11-04' }],
    ]);
  });

  it('starts the week on Monday and wraps months and years', () => {
    expect(resolvePeriod('this_week', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(resolvePeriod('this_week', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(resolvePeriod('this_week', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-01' });
    expect(resolvePeriod('yesterday', '2027-01-01')).toEqual({ from: '2026-12-31', to: '2026-12-31' });
    expect(resolvePeriod('this_month', '2026-03-01')).toEqual({ from: '2026-03-01', to: '2026-03-01' });
  });

  it('lists every calendar day, also across a DST change', () => {
    expect(periodDays('2026-10-24', '2026-10-27')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(periodDays('2026-11-04', '2026-11-04')).toEqual(['2026-11-04']);
    expect(periodDays('2026-01-01', '2026-12-31')).toHaveLength(365);
  });

  it('allows to − from up to 365 days, so a range covers at most 366 days', () => {
    expect(REPORT_LIMITS).toEqual({ maxRangeDays: 366, pageSize: 50, exportRowCap: 10_000, statementTimeoutMs: 15_000 });
    expect(reportRangeTooLong('2026-01-01', '2027-01-01')).toBe(false);
    expect(periodDays('2026-01-01', '2027-01-01')).toHaveLength(366);
    expect(reportRangeTooLong('2026-01-01', '2027-01-02')).toBe(true);
    expect(reportRangeTooLong('2026-11-04', '2026-11-04')).toBe(false);
  });
});

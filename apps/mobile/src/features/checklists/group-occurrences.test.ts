import type { OccurrenceView } from '@/offline/execution-store';
import type { LocalExecution } from '@/offline/local-model';
import { ME, OCC, OTHER, OTHER_EXECUTION, REWORK_DUE, reworkRequest, T, VERSION } from '@/offline/testing/fixtures';
import { groupOccurrences, homeStats } from './group-occurrences';

const view = (over: Partial<OccurrenceView> = {}): OccurrenceView => ({
  id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
  startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'pending', checklistVersionId: VERSION, claim: null, execution: null, unsynced: false, ...over,
});
const execution = (over: Partial<LocalExecution> = {}): LocalExecution => ({
  id: 'e', occurrenceId: OCC, checklistVersionId: VERSION, state: 'active', claim: 'accepted', rejectedReason: null, rejectedBy: null,
  startedAt: T.open, completedAt: null, lockedAt: null, answers: {}, rev: 0, syncedRev: 0, finishedSyncedAt: null, updatedAt: T.open, syncNote: null,
  reworkRound: 0, rework: null, ...over,
});
const at = (iso: string) => Date.parse(iso);
const place = (o: OccurrenceView, now: string) => {
  const g = groupOccurrences([o], ME, at(now), '2026-11-02');
  const key = (Object.keys(g) as (keyof typeof g)[]).find((k) => g[k].length > 0) ?? null;
  return key ? { key, card: g[key][0]! } : null;
};

describe('groupOccurrences', () => {
  it.each<[string, OccurrenceView, string, string | null, object]>([
    ['open: startable', view(), T.open, 'now', { action: 'start', overdue: false }],
    ['open past due: overdue', view(), '2026-11-02T06:30:00.000Z', 'now', { overdue: true }],
    ['claimed by someone else: badge, no start', view({ status: 'started', claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad' } }), T.open, 'now', { action: 'none', claimedBy: 'Murad' }],
    ['my open execution: in progress', view({ execution: execution() }), T.open, 'inProgress', { action: 'continue' }],
    ['not open yet: upcoming, read-only', view({ startsAt: '2026-11-02T14:00:00.000Z' }), T.open, 'upcoming', { action: 'none' }],
    ['completed late today: done with late', view({ status: 'completed', execution: execution({ state: 'completed', completedAt: '2026-11-02T06:10:00.000Z' }) }), '2026-11-02T08:00:00.000Z', 'done', { action: 'view', late: true }],
    ['my execution past closes_at: done', view({ execution: execution() }), T.closes, 'done', { action: 'view' }],
    ['missed today without an execution: done', view({ status: 'missed' }), '2026-11-02T08:00:00.000Z', 'done', { action: 'none' }],
    ['finished yesterday: not shown', view({ status: 'completed', localDate: '2026-11-01' }), T.open, null, {}],
    // A night shift: yesterday's occurrence, finished by me a few hours ago, stays reachable.
    ['my execution of yesterday finished within 24 h: done', view({ localDate: '2026-11-01', execution: execution({ state: 'completed', completedAt: '2026-11-01T22:00:00.000Z' }) }), T.open, 'done', { action: 'view' }],
    ['my execution of yesterday locked within 24 h: done', view({ localDate: '2026-11-01', closesAt: '2026-11-01T23:00:00.000Z', execution: execution({ state: 'partial', lockedAt: '2026-11-01T23:00:00.000Z' }) }), T.open, 'done', { action: 'view' }],
    ['my execution finished over 24 h ago: not shown', view({ localDate: '2026-10-31', closesAt: '2026-10-31T07:00:00.000Z', execution: execution({ state: 'completed', completedAt: '2026-10-31T06:00:00.000Z' }) }), T.open, null, {}],
    ['an older execution with unsent or failed commands: done', view({ localDate: '2026-10-30', closesAt: '2026-10-30T07:00:00.000Z', unsynced: true, execution: execution({ state: 'completed', completedAt: '2026-10-30T06:00:00.000Z' }) }), T.open, 'done', { action: 'view' }],
  ])('%s', (_name, o, now, key, card) => {
    const placed = place(o, now);
    expect(placed?.key ?? null).toBe(key);
    if (placed) expect(placed.card).toMatchObject(card);
  });

  it('counts my open and in-progress work, overdue ones, today\'s completions and problems', () => {
    const list = [
      view({ id: 'a' }),
      view({ id: 'b', execution: execution({ id: 'eb', occurrenceId: 'b' }) }),
      view({ id: 'c', claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad' } }),
      view({ id: 'd', status: 'completed' }),
    ];
    const g = groupOccurrences(list, ME, at('2026-11-02T06:30:00.000Z'), '2026-11-02');
    expect(homeStats(g, 3)).toEqual({ myTasks: 2, overdue: 2, completed: 1, issues: 3 });
  });

  it('puts a run sent back to me first, with its round, due date and flagged items, overdue once the due date passed', () => {
    const rework = reworkRequest({ items: [{ itemId: 'a', comment: 'x' }, { itemId: 'b', comment: 'y' }] });
    const o = view({ status: 'correction_required', localDate: '2026-10-30', execution: execution({ state: 'rework', completedAt: '2026-10-30T06:00:00.000Z', reworkRound: 1, rework }) });
    expect(place(o, T.open)).toMatchObject({ key: 'rework', card: { action: 'continue', overdue: false, claimedBy: null, rework: { round: 1, dueAt: REWORK_DUE, items: 2 } } });
    expect(place(o, REWORK_DUE)?.card.overdue).toBe(true);
    const noDue = view({ status: 'correction_required', execution: execution({ state: 'rework', reworkRound: 1, rework: reworkRequest({ dueAt: null }) }) });
    expect(place(noDue, '2026-12-01T00:00:00.000Z')?.card).toMatchObject({ overdue: false, rework: { dueAt: null } });
  });

  it('treats a run sent back to someone else as closed', () => {
    const o = view({ status: 'correction_required', claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad' } });
    expect(place(o, T.open)).toMatchObject({ key: 'done', card: { action: 'none', claimedBy: 'Murad', rework: null } });
  });

  it('keeps a run I resubmitted here among the finished ones until the server answers', () => {
    const o = view({
      status: 'correction_required', localDate: '2026-10-30', closesAt: '2026-10-30T07:00:00.000Z', unsynced: true,
      execution: execution({ state: 'completed', completedAt: '2026-10-30T06:00:00.000Z', reworkRound: 1, rework: reworkRequest() }),
    });
    expect(place(o, T.open)).toMatchObject({ key: 'done', card: { action: 'view', rework: null } });
  });

  it('counts runs to correct as my tasks, and as overdue once past their due date', () => {
    const list = [
      view({ id: 'r', status: 'correction_required', execution: execution({ id: 'er', occurrenceId: 'r', state: 'rework', reworkRound: 1, rework: reworkRequest({ dueAt: T.before }) }) }),
      view({ id: 'a' }),
    ];
    const g = groupOccurrences(list, ME, at('2026-11-02T06:30:00.000Z'), '2026-11-02');
    expect(homeStats(g, 0)).toEqual({ myTasks: 2, overdue: 2, completed: 0, issues: 0 });
  });
});

import type { OccurrenceView } from '@/offline/execution-store';
import type { LocalExecution } from '@/offline/local-model';
import { ME, OCC, OTHER, OTHER_EXECUTION, T, VERSION } from '@/offline/testing/fixtures';
import { groupOccurrences, homeStats } from './group-occurrences';

const view = (over: Partial<OccurrenceView> = {}): OccurrenceView => ({
  id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
  startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'pending', checklistVersionId: VERSION, claim: null, execution: null, ...over,
});
const execution = (over: Partial<LocalExecution> = {}): LocalExecution => ({
  id: 'e', occurrenceId: OCC, checklistVersionId: VERSION, state: 'active', claim: 'accepted', rejectedReason: null, rejectedBy: null,
  startedAt: T.open, completedAt: null, lockedAt: null, answers: {}, rev: 0, syncedRev: 0, finishedSyncedAt: null, ...over,
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
});

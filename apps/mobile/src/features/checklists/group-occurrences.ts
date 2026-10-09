import type { OccurrenceView } from '@/offline/execution-store';

export const GROUP_KEYS = ['now', 'inProgress', 'upcoming', 'done'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export type CardAction = 'start' | 'continue' | 'view' | 'none';

export interface CardModel {
  occurrence: OccurrenceView;
  /** Past due and not finished: shown in red (FR-10.02). */
  overdue: boolean;
  /** Finished at or after due_at. */
  late: boolean;
  /** "Murad icra edir" when someone else holds the claim. */
  claimedBy: string | null;
  action: CardAction;
}

export type Groups = Record<GroupKey, CardModel[]>;

const CLOSED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'missed', 'cancelled', 'audit_pending', 'audited']);

/** Spec §7.3: İndi (open; overdue in red), Davam edən (my open execution), Gələcək (not open yet), Bitmiş (finished today). */
export function groupOccurrences(list: OccurrenceView[], userId: string, now: number, today: string): Groups {
  const groups: Groups = { now: [], inProgress: [], upcoming: [], done: [] };
  for (const o of list) {
    const e = o.execution;
    const due = Date.parse(o.dueAt);
    const closes = Date.parse(o.closesAt);
    const claimedBy = o.claim && o.claim.executorUserId !== userId ? o.claim.executorName : null;
    if (e?.state === 'active' && now < closes) {
      groups.inProgress.push({ occurrence: o, overdue: now >= due, late: false, claimedBy: null, action: 'continue' });
    } else if (e || CLOSED_STATUSES.has(o.status) || now >= closes) {
      if (o.localDate !== today) continue;
      const late = e?.completedAt ? Date.parse(e.completedAt) >= due : false;
      groups.done.push({ occurrence: o, overdue: false, late, claimedBy, action: e ? 'view' : 'none' });
    } else if (now < Date.parse(o.startsAt)) {
      groups.upcoming.push({ occurrence: o, overdue: false, late: false, claimedBy, action: 'none' });
    } else {
      groups.now.push({ occurrence: o, overdue: now >= due || o.status === 'overdue', late: false, claimedBy, action: claimedBy ? 'none' : 'start' });
    }
  }
  return groups;
}

export interface HomeStats {
  myTasks: number;
  overdue: number;
  completed: number;
  issues: number;
}

/** The home tiles, for today (decision 1). Occurrences someone else holds are not my tasks. */
export function homeStats(groups: Groups, problemsToday: number): HomeStats {
  const mine = [...groups.now.filter((c) => !c.claimedBy), ...groups.inProgress];
  return {
    myTasks: mine.length,
    overdue: mine.filter((c) => c.overdue).length,
    completed: groups.done.filter((c) => (c.occurrence.execution?.state ?? c.occurrence.status) === 'completed').length,
    issues: problemsToday,
  };
}

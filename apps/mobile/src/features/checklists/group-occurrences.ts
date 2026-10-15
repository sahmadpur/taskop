import type { OccurrenceView } from '@/offline/execution-store';
import type { LocalExecution } from '@/offline/local-model';

/** `rework` (spec §8.1, "Needs correction") sits above today's runs. */
export const GROUP_KEYS = ['rework', 'now', 'inProgress', 'upcoming', 'done'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export type CardAction = 'start' | 'continue' | 'view' | 'none';

/** A run sent back to me for correction (spec §8.1). */
export interface ReworkCard {
  round: number;
  /** The manager's due date; null when none was set. */
  dueAt: string | null;
  /** How many items were sent back. */
  items: number;
}

export interface CardModel {
  occurrence: OccurrenceView;
  /** Past due and not finished: shown in red (FR-10.02). For a run to correct: its due date has passed. */
  overdue: boolean;
  /** Finished at or after due_at. */
  late: boolean;
  /** "Murad icra edir" when someone else holds the claim. */
  claimedBy: string | null;
  action: CardAction;
  /** Set on the cards of the `rework` group only. */
  rework: ReworkCard | null;
}

export type Groups = Record<GroupKey, CardModel[]>;

/** Closed for everyone but the executor of a run sent back for correction, whose execution decides first (spec §3.1). */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'missed', 'cancelled', 'audit_pending', 'audited', 'correction_required']);
const RECENT_MS = 24 * 60 * 60 * 1000;

/** When my execution stopped being open: completed, locked at closes_at, or (refused, rejected) last changed. */
function finishedAt(e: LocalExecution): number {
  return Date.parse(e.completedAt ?? e.lockedAt ?? e.updatedAt);
}

/**
 * Spec §7.3: İndi (open; overdue in red), Davam edən (my open execution), Gələcək (not open yet), Bitmiş (finished
 * today). Bitmiş also keeps my executions that still have commands on the phone, or that finished within the last
 * 24 h whatever their date (a night shift's occurrence belongs to yesterday), so they stay reachable.
 * SP8 spec §8.1: runs sent back to me come first, whatever their date; they are not limited by closes_at.
 */
export function groupOccurrences(list: OccurrenceView[], userId: string, now: number, today: string): Groups {
  const groups: Groups = { rework: [], now: [], inProgress: [], upcoming: [], done: [] };
  for (const o of list) {
    const e = o.execution;
    const due = Date.parse(o.dueAt);
    const closes = Date.parse(o.closesAt);
    const claimedBy = o.claim && o.claim.executorUserId !== userId ? o.claim.executorName : null;
    if (e?.state === 'rework' && e.rework) {
      const dueAt = e.rework.dueAt;
      groups.rework.push({
        occurrence: o,
        overdue: dueAt !== null && now >= Date.parse(dueAt),
        late: false,
        claimedBy: null,
        action: 'continue',
        rework: { round: e.rework.round, dueAt, items: e.rework.items.length },
      });
    } else if (e?.state === 'active' && now < closes) {
      groups.inProgress.push({ occurrence: o, overdue: now >= due, late: false, claimedBy: null, action: 'continue', rework: null });
    } else if (e || CLOSED_STATUSES.has(o.status) || now >= closes) {
      const keep = o.localDate === today || (e !== null && (o.unsynced || now - finishedAt(e) < RECENT_MS));
      if (!keep) continue;
      const late = e?.completedAt ? Date.parse(e.completedAt) >= due : false;
      groups.done.push({ occurrence: o, overdue: false, late, claimedBy, action: e ? 'view' : 'none', rework: null });
    } else if (now < Date.parse(o.startsAt)) {
      groups.upcoming.push({ occurrence: o, overdue: false, late: false, claimedBy, action: 'none', rework: null });
    } else {
      groups.now.push({ occurrence: o, overdue: now >= due || o.status === 'overdue', late: false, claimedBy, action: claimedBy ? 'none' : 'start', rework: null });
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

/** The home tiles, for today (decision 1). Occurrences someone else holds are not my tasks; runs to correct are (Spec decision 6). */
export function homeStats(groups: Groups, problemsToday: number): HomeStats {
  const mine = [...groups.rework, ...groups.now.filter((c) => !c.claimedBy), ...groups.inProgress];
  return {
    myTasks: mine.length,
    overdue: mine.filter((c) => c.overdue).length,
    completed: groups.done.filter((c) => (c.occurrence.execution?.state ?? c.occurrence.status) === 'completed').length,
    issues: problemsToday,
  };
}

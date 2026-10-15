import { DELIVERY_STATUSES, type DeliveryCounts, isProblemType, type NotificationItem, type NotificationType } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import type { OccurrenceTab } from '@/features/scheduling/occurrence-dialog';
import type { ScheduleSearch } from '@/features/scheduling/routes';
import type { TasksSearch } from '@/features/tasks/routes';

export type NotificationLink = { to: '/schedule'; search: ScheduleSearch } | { to: '/tasks'; search: TasksSearch };

/** SP8: the run dialog tab an audit notification is about (decision 18). Problems open the execution tab. */
const RUN_TABS: Partial<Record<NotificationType, OccurrenceTab>> = {
  'run.correction_required': 'execution',
  'run.resubmitted': 'corrections',
  'audit.finished': 'audit',
};

/**
 * Where a notification leads on the web (spec §8). `null`: it has no page of its own (manual messages, or a target
 * id that is missing) and the caller keeps the user in the inbox. Problems open the run's execution tab.
 */
export function notificationLink(n: Pick<NotificationItem, 'type' | 'targetKind' | 'targetId' | 'targetDate'>): NotificationLink | null {
  if (!n.targetId) return null;
  if (n.targetKind === 'task') return { to: '/tasks', search: { task: n.targetId } };
  if (n.targetKind === 'occurrence') {
    const tab: OccurrenceTab | undefined = isProblemType(n.type) ? 'execution' : RUN_TABS[n.type];
    return {
      to: '/schedule',
      search: {
        // Without a date the schedule opens the current week; the drawer still opens the occurrence.
        ...(n.targetDate ? { date: n.targetDate } : {}),
        occurrence: n.targetId,
        ...(tab ? { tab } : {}),
      },
    };
  }
  return null;
}

export const UNREAD_BADGE_MAX = 99;

/** The bell's badge: nothing at 0, the number up to 99, then "99+". */
export const unreadBadgeText = (count: number): string | null =>
  count <= 0 ? null : count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count);

/** "Çatdırılıb: 2 · Uğursuz: 1": the statuses that occur on one channel, in DELIVERY_STATUSES order. */
export function deliverySummary(t: TFunction, counts: DeliveryCounts): string {
  const parts = DELIVERY_STATUSES.filter((s) => counts[s] > 0).map((s) => `${t(`notifications.deliveryStatuses.${s}`)}: ${counts[s]}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

import type { NotificationItem } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { api } from '@/lib/session';
import { notificationLink } from './labels';
import { notificationKeys } from './queries';

/**
 * Opening a notification (spec §8): the user is taken to the target immediately; an unread one is marked read in the
 * background and the inbox queries are refetched when that settles. A failure there (the row was cleaned up after
 * 90 days, 404, or the network dropped) never blocks or reverts the navigation; the refetch shows the true state.
 * Without a page of its own it opens the inbox when `inboxFallback` is set (the bell) or stays (the inbox page).
 */
export function useOpenNotification() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    async (n: NotificationItem, { inboxFallback }: { inboxFallback: boolean }): Promise<void> => {
      if (n.readAt === null) {
        void api.notifications
          .markRead(n.id)
          .catch(() => {
            // Deliberately ignored: see above.
          })
          .finally(() => qc.invalidateQueries({ queryKey: notificationKeys.all }));
      }
      const link = notificationLink(n);
      if (link?.to === '/schedule') await navigate({ to: '/schedule', search: link.search });
      else if (link?.to === '/tasks') await navigate({ to: '/tasks', search: link.search });
      else if (inboxFallback) await navigate({ to: '/notifications' });
    },
    [qc, navigate],
  );
}

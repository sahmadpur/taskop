import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { errorText } from '@/lib/errors';
import { unreadBadgeText } from './labels';
import { NotificationRow } from './notification-row';
import { useOpenNotification } from './open-notification';
import { useLatestNotifications, useMarkAllRead, useUnreadCount } from './queries';

/** Spec §8: the header bell. The badge polls (30 s, focus); the popover lists the 10 latest while it is open. */
export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const latest = useLatestNotifications(open);
  const markAll = useMarkAllRead();
  const openNotification = useOpenNotification();
  const count = unread.data?.count ?? 0;
  const badge = unreadBadgeText(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count > 0 ? t('notifications.bell.unread', { count }) : t('nav.notifications')}
        >
          <Bell className="size-4" aria-hidden />
          {badge && (
            <span aria-hidden className="bg-destructive absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold text-white">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" aria-label={t('notifications.title')}>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="font-medium">{t('notifications.title')}</span>
          <Button variant="ghost" size="sm" disabled={count === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            {t('notifications.markAllRead')}
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {latest.isPending && <p className="text-muted-foreground px-3 py-2">{t('common.loading')}</p>}
          {latest.isError && <p className="text-destructive px-3 py-2">{errorText(t, latest.error)}</p>}
          {latest.isSuccess && latest.data.length === 0 && <p className="text-muted-foreground px-3 py-2">{t('notifications.empty')}</p>}
          {latest.isSuccess && latest.data.length > 0 && (
            <ul aria-label={t('notifications.title')} className="grid gap-0.5">
              {latest.data.map((n) => (
                <NotificationRow
                  key={n.id}
                  item={n}
                  compact
                  onOpen={(item) => {
                    setOpen(false);
                    openNotification(item, { inboxFallback: true }).catch((error: unknown) => {
                      console.error('Opening the notification failed', error);
                    });
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2 text-right">
          <Link to="/notifications" className="text-sm font-medium underline-offset-4 hover:underline" onClick={() => setOpen(false)}>
            {t('notifications.bell.viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

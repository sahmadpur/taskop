import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/errors';
import { NotificationRow } from './notification-row';
import { useOpenNotification } from './open-notification';
import { useInbox, useMarkAllRead, useUnreadCount } from './queries';

/** Spec §8: the full inbox, newest first, 30 per page, with an "unread only" filter. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inbox = useInbox(unreadOnly);
  const unread = useUnreadCount();
  const markAll = useMarkAllRead();
  const openNotification = useOpenNotification();
  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader
        title={t('notifications.title')}
        actions={
          <Button variant="outline" disabled={(unread.data?.count ?? 0) === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            {t('notifications.markAllRead')}
          </Button>
        }
      />
      <div className="flex items-center gap-2">
        <Checkbox id="notifications-unread-only" checked={unreadOnly} onCheckedChange={(c) => setUnreadOnly(c === true)} />
        <Label htmlFor="notifications-unread-only" className="font-normal">
          {t('notifications.inbox.unreadOnly')}
        </Label>
      </div>
      {inbox.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {inbox.error && <p className="text-destructive">{errorText(t, inbox.error)}</p>}
      {inbox.isSuccess && items.length === 0 && (
        <p className="text-muted-foreground">{unreadOnly ? t('notifications.inbox.emptyUnread') : t('notifications.empty')}</p>
      )}
      {items.length > 0 && (
        <ul aria-label={t('notifications.title')} className="grid gap-1 rounded-md border p-1">
          {items.map((n) => (
            <NotificationRow key={n.id} item={n} onOpen={(item) => void openNotification(item, { inboxFallback: false })} />
          ))}
        </ul>
      )}
      {inbox.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
          {t('notifications.inbox.more')}
        </Button>
      )}
    </div>
  );
}

import type { NotificationItem } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { useFormatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  item: NotificationItem;
  onOpen: (item: NotificationItem) => void;
  /** The bell's popover: the body is cut to two lines. */
  compact?: boolean;
}

/** One inbox entry (bell and /notifications). The whole row is the button; unread ones are bold with a dot. */
export function NotificationRow({ item, onOpen, compact = false }: Props) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const unread = item.readAt === null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn('hover:bg-accent grid w-full gap-0.5 rounded-md px-3 py-2 text-left', unread && 'bg-accent/40')}
      >
        <span className="flex items-center gap-2">
          {unread && <span aria-hidden className="bg-primary size-2 shrink-0 rounded-full" />}
          <span className={cn('text-sm', unread ? 'font-semibold' : 'font-normal')}>{item.title}</span>
          {unread && <span className="sr-only">{t('notifications.inbox.unread')}</span>}
        </span>
        <span className={cn('text-muted-foreground text-sm whitespace-pre-line', compact && 'line-clamp-2')}>{item.body}</span>
        <span className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</span>
      </button>
    </li>
  );
}

import type { DeliveryChannel, MessageDetail, MessageSummary } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { deliverySummary } from './labels';
import { useMessage, useMessages } from './queries';
import { LoadingState, EmptyState } from '@/components/states';

const COLUMNS = ['sentAt', 'sender', 'title', 'recipients', 'read', 'push', 'email'] as const;

/** One channel of a message: still fanning out, e-mail not asked for, or its status counts (decision 13). */
const channelText = (t: TFunction, m: MessageSummary, channel: DeliveryChannel): string =>
  !m.processed
    ? t('notifications.messages.processing')
    : channel === 'email' && !m.emailRequested
      ? t('notifications.messages.notRequested')
      : deliverySummary(t, m[channel]);

/** Spec §8: the tenant's manual messages, newest first (a sender without notifications.manage sees their own). */
export function MessageHistory() {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const messages = useMessages();
  const items = messages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="grid gap-3">
      {messages.isPending && <LoadingState />}
      {messages.error && <p className="text-destructive">{errorText(t, messages.error)}</p>}
      {messages.isSuccess && items.length === 0 && <EmptyState title={t('notifications.messages.emptyHistory')} />}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`notifications.messages.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(m.sentAt)}</TableCell>
                <TableCell>{m.sender?.fullName ?? '—'}</TableCell>
                <TableCell>
                  <Link to="/messages" search={{ message: m.id }} className="font-medium underline-offset-4 hover:underline">
                    {m.title}
                  </Link>
                </TableCell>
                <TableCell>{m.processed ? m.recipientCount : '—'}</TableCell>
                <TableCell>{m.processed ? m.readCount : '—'}</TableCell>
                <TableCell>{channelText(t, m, 'push')}</TableCell>
                <TableCell>{channelText(t, m, 'email')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {messages.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
          {t('notifications.messages.more')}
        </Button>
      )}
    </div>
  );
}

/** Spec §8, NFR-11.02: who got the message, who read it, and each channel's status and last error. */
export function MessageDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const message = useMessage(id);
  const m = message.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{m?.title ?? t('notifications.messages.detailTitle')}</DialogTitle>
          <DialogDescription>
            {m
              ? t('notifications.messages.sentBy', { name: m.sender?.fullName ?? '—', time: formatDateTime(m.sentAt) })
              : message.isPending
                ? t('common.loading')
                : ''}
          </DialogDescription>
        </DialogHeader>
        {message.isError && <p className="text-destructive">{errorText(t, message.error)}</p>}
        {m && <MessageDetailBody m={m} />}
      </DialogContent>
    </Dialog>
  );
}

function MessageDetailBody({ m }: { m: MessageDetail }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const targets = [
    { key: 'people', names: m.targets.users.map((u) => u.fullName) },
    { key: 'teams', names: m.targets.teams.map((x) => x.name) },
    { key: 'sites', names: m.targets.sites.map((x) => x.name) },
  ].filter((g) => g.names.length > 0);
  return (
    <div className="grid max-h-[70vh] gap-4 overflow-y-auto">
      <p className="whitespace-pre-line">{m.body}</p>
      <section aria-label={t('notifications.messages.targets')} className="grid gap-1 text-sm">
        {targets.map((g) => (
          <p key={g.key}>{`${t(`notifications.messages.${g.key}`)}: ${g.names.join(', ')}`}</p>
        ))}
      </section>
      {!m.processed ? (
        <p className="text-muted-foreground">{t('notifications.messages.noRecipientsYet')}</p>
      ) : (
        <>
          <div className="grid gap-1 text-sm">
            <p>{t('notifications.messages.totals', { recipients: m.recipientCount, read: m.readCount })}</p>
            <p>{`${t('notifications.channels.push')}: ${deliverySummary(t, m.push)}`}</p>
            <p>{`${t('notifications.channels.email')}: ${m.emailRequested ? deliverySummary(t, m.email) : t('notifications.messages.notRequested')}`}</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('notifications.messages.recipient')}</TableHead>
                <TableHead>{t('notifications.messages.columns.read')}</TableHead>
                <TableHead>{t('notifications.channels.push')}</TableHead>
                <TableHead>{t('notifications.channels.email')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.recipients.map((r) => (
                <TableRow key={r.user.id}>
                  <TableCell>{r.user.fullName}</TableCell>
                  <TableCell>{r.readAt ? formatDateTime(r.readAt) : t('notifications.messages.notRead')}</TableCell>
                  <TableCell>
                    {r.push.status
                      ? `${t(`notifications.deliveryStatuses.${r.push.status}`)}${r.push.devices > 1 ? ` · ${t('notifications.messages.devices', { count: r.push.devices })}` : ''}`
                      : t('notifications.messages.noDevice')}
                    {r.push.lastError && <p className="text-destructive text-xs">{r.push.lastError}</p>}
                  </TableCell>
                  <TableCell>
                    {r.email.status ? t(`notifications.deliveryStatuses.${r.email.status}`) : '—'}
                    {r.email.lastError && <p className="text-destructive text-xs">{r.email.lastError}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

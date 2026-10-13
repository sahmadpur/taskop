import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ComposeMessage } from './compose-message';
import { MessageDetailDialog, MessageHistory } from './message-history';
import type { MessagesSearch } from './routes';

/** Spec §8: "Mesajlar" for notifications.send holders: compose, then the history; `?message=<id>` opens a detail. */
export function MessagesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as MessagesSearch;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('nav.messages')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.messages.compose')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ComposeMessage />
        </CardContent>
      </Card>
      <section aria-labelledby="messages-history" className="grid gap-2">
        <h2 id="messages-history" className="text-lg font-semibold">
          {t('notifications.messages.history')}
        </h2>
        <MessageHistory />
      </section>
      {search.message && <MessageDetailDialog id={search.message} onClose={() => void navigate({ to: '/messages', search: {} })} />}
    </div>
  );
}

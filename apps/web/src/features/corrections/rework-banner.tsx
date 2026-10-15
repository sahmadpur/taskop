import { type ExecutionDetail, walkItems } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFormatDateTime } from '@/lib/format';

/** While a send-back is open (decision 13): the round, who sent it back and when, the due date and the flagged items. */
export function ReworkBanner({ detail }: { detail: ExecutionDetail }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const r = detail.rework;
  if (!r) return null;
  const labels = new Map<string, string>();
  walkItems(detail.content, (item) => labels.set(item.id, item.label));
  return (
    <Alert>
      <AlertTitle>{`${t('corrections.reworkBanner')} · ${t('corrections.round', { round: r.round })}`}</AlertTitle>
      <AlertDescription className="grid gap-1">
        <p>
          {t('corrections.web.rework.requestedBy', { name: r.requestedBy?.fullName ?? t('scheduling.schedule.actorPlatform'), time: formatDateTime(r.requestedAt) })}
          {r.dueAt ? ` · ${t('corrections.dueAt', { date: formatDateTime(r.dueAt) })}` : ''}
        </p>
        <p className="font-medium">{t('corrections.web.rework.flagged')}</p>
        <ul className="list-disc pl-5">
          {r.items.map((i) => (
            <li key={i.itemId}>{`${labels.get(i.itemId) ?? t('executions.problemsPage.unknownItem')} — ${i.comment}`}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

import { type Item, type OccurrenceDetail, walkItems } from '@taskop/contracts';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { actorName } from '@/features/audits/labels';
import { useExecution } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { answerSummary, correctionTimeline, scoreText, type TimelineEntry } from './labels';
import { useCorrections } from './queries';

/** The run dialog's "Düzəlişlər" tab (spec §8.3, NFR-07.05): original against current, then what happened when. */
export function CorrectionsTab({ occurrence }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  if (!occurrence.execution) return <p className="text-muted-foreground">{t('executions.notStarted')}</p>;
  return <RunCorrections executionId={occurrence.execution.id} />;
}

function RunCorrections({ executionId }: { executionId: string }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const formatDateTime = useFormatDateTime();
  const detail = useExecution(executionId);
  const history = useCorrections(executionId);
  const items = useMemo(() => {
    const map = new Map<string, Item>();
    if (detail.data) walkItems(detail.data.content, (item) => map.set(item.id, item));
    return map;
  }, [detail.data]);

  if (detail.isError || history.isError) return <p className="text-destructive">{errorText(t, detail.error ?? history.error)}</p>;
  if (!detail.data || !history.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  const c = history.data;
  const timeline = correctionTimeline(c);
  if (!c.original && timeline.length === 0) return <p className="text-muted-foreground">{t('corrections.noCorrections')}</p>;
  const label = (itemId: string) => items.get(itemId)?.label ?? t('executions.problemsPage.unknownItem');
  const summaryOf = (itemId: string, a: Parameters<typeof answerSummary>[2]) => {
    const item = items.get(itemId);
    return item ? answerSummary(t, item, a, formatDateTime) : '—';
  };

  return (
    <div className="grid gap-5">
      {c.original && (
        <p className="text-sm">
          {t('corrections.web.score.original', { value: scoreText(t, c.original.score, tenant.locale) })} ·{' '}
          {t('corrections.web.score.current', { value: scoreText(t, detail.data.score, tenant.locale) })}
        </p>
      )}
      {c.diff.length > 0 && (
        <section aria-labelledby="corrections-diff" className="grid gap-2">
          <h3 id="corrections-diff" className="font-medium">
            {t('corrections.web.diff.title')}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('corrections.web.diff.item')}</TableHead>
                <TableHead>{t('corrections.original')}</TableHead>
                <TableHead>{t('corrections.current')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.diff.map((d) => (
                <TableRow key={d.itemId}>
                  <TableCell className="font-medium">{label(d.itemId)}</TableCell>
                  <TableCell>{summaryOf(d.itemId, d.original)}</TableCell>
                  <TableCell>{summaryOf(d.itemId, d.current)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {c.original && <p className="text-muted-foreground text-xs">{t('corrections.web.diff.capturedAt', { time: formatDateTime(c.original.capturedAt) })}</p>}
        </section>
      )}
      {timeline.length > 0 && (
        <section className="grid gap-2">
          <h3 id="corrections-timeline" className="font-medium">
            {t('corrections.web.timeline.title')}
          </h3>
          <ol aria-labelledby="corrections-timeline" className="grid gap-2">
            {timeline.map((entry, i) => (
              <TimelineRow key={i} entry={entry} label={label} summaryOf={summaryOf} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function TimelineRow({
  entry,
  label,
  summaryOf,
}: {
  entry: TimelineEntry;
  label: (itemId: string) => string;
  summaryOf: (itemId: string, a: Parameters<typeof answerSummary>[2]) => string;
}) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const when = <span className="text-muted-foreground">{formatDateTime(entry.at)}</span>;

  if (entry.kind === 'correction') {
    const x = entry.correction;
    return (
      <li data-kind={entry.kind} className="grid gap-0.5 rounded-md border p-2 text-sm">
        <p>
          {when} · {t(`corrections.kinds.${x.kind}`)} · {actorName(t, x.actor)}
        </p>
        <p>{`${label(x.itemId)}: ${summaryOf(x.itemId, x.before)} → ${summaryOf(x.itemId, x.after)}`}</p>
        <p className="text-muted-foreground">
          {x.kind === 'manual' ? t('corrections.web.timeline.reason', { reason: x.reason }) : t('corrections.web.timeline.comment', { comment: x.reason })}
        </p>
      </li>
    );
  }

  const r = entry.request;
  const round = t('corrections.round', { round: r.round });
  return (
    <li data-kind={entry.kind} className="grid gap-0.5 rounded-md border p-2 text-sm">
      <p>
        {when} ·{' '}
        {entry.kind === 'sentBack'
          ? t('corrections.web.timeline.sentBack', { name: r.requestedBy?.fullName ?? t('scheduling.schedule.actorPlatform') })
          : entry.kind === 'resubmitted'
            ? t('corrections.web.timeline.resubmitted')
            : t('corrections.web.timeline.withdrawn', { name: r.withdrawnBy?.fullName ?? t('scheduling.schedule.actorPlatform') })}{' '}
        · {round}
      </p>
      {entry.kind === 'sentBack' && (
        <>
          {r.dueAt && <p className="text-muted-foreground">{t('corrections.dueAt', { date: formatDateTime(r.dueAt) })}</p>}
          <ul className="list-disc pl-5">
            {r.items.map((i) => (
              <li key={i.itemId}>{`${label(i.itemId)} — ${i.comment}`}</li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

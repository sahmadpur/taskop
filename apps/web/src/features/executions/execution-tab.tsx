import type { ExecutionDetail, ExecutionSummary, OccurrenceDetail } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { AnswersView } from './answers-view';
import { executionStateVariant, formatPercent, receiptDiffers } from './labels';
import { useExecution } from './queries';

/** The schedule drawer's "İcra" tab (spec §8): the counted execution, then the rejected ones, collapsed. */
export function ExecutionTab({ occurrence }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      {occurrence.execution ? (
        <CountedExecution summary={occurrence.execution} />
      ) : (
        <p className="text-muted-foreground">{t('executions.notStarted')}</p>
      )}
      {occurrence.rejectedExecutions.length > 0 && <RejectedExecutions items={occurrence.rejectedExecutions} />}
    </div>
  );
}

function CountedExecution({ summary }: { summary: ExecutionSummary }) {
  const detail = useExecution(summary.id);
  return (
    <div className="grid gap-4">
      <SummaryView summary={summary} detail={detail.data} />
      <ExecutionAnswers id={summary.id} />
    </div>
  );
}

function ExecutionAnswers({ id }: { id: string }) {
  const { t } = useTranslation();
  const detail = useExecution(id);
  if (detail.isError) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  if (!detail.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  const d = detail.data;
  return <AnswersView content={d.content} answers={d.answers} media={d.media} problems={d.problems} />;
}

const deviceLine = (t: TFunction, summary: ExecutionSummary, d: ExecutionDetail): string => {
  const device = t('executions.device', { platform: d.device.platform, osVersion: d.device.osVersion, appVersion: d.device.appVersion });
  return summary.clockSuspect && d.clockOffsetMs !== null
    ? `${device} · ${t('executions.clockOffset', { seconds: Math.round(d.clockOffsetMs / 1000) })}`
    : device;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      {children}
    </div>
  );
}

function SummaryView({ summary, detail }: { summary: ExecutionSummary; detail?: ExecutionDetail }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const formatDateTime = useFormatDateTime();
  const { answered, total, requiredMissing } = summary.progress;
  // Device time decides the status (BR-11); the server receipt is only shown when it tells a different story.
  const when = (label: string, deviceAt: string | null, receivedAt: string | null) => (
    <Field label={label}>
      <dd>{deviceAt ? formatDateTime(deviceAt) : t('executions.notCompleted')}</dd>
      {deviceAt && receivedAt && receiptDiffers(deviceAt, receivedAt) && (
        <dd className="text-muted-foreground text-xs">{t('executions.receivedAt', { time: formatDateTime(receivedAt) })}</dd>
      )}
    </Field>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={executionStateVariant(summary.state)}>{t(`executions.states.${summary.state}`)}</Badge>
        {summary.late && <Badge variant="destructive">{t('executions.flags.late')}</Badge>}
        {summary.clockSuspect && <Badge variant="outline">{t('executions.flags.clockSuspect')}</Badge>}
        {summary.mediaPending > 0 && <Badge variant="outline">{t('executions.flags.mediaPending', { count: summary.mediaPending })}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label={t('executions.executor')}>
          <dd>{summary.executor.fullName}</dd>
        </Field>
        {when(t('executions.startedAt'), summary.startedAt, summary.startedReceivedAt)}
        {when(t('executions.completedAt'), summary.completedAt, summary.completedReceivedAt)}
        <Field label={t('executions.score')}>
          <dd>
            {summary.scorePercent === null
              ? t('executions.noScore')
              : t('executions.percent', { value: formatPercent(summary.scorePercent, tenant.locale) })}
          </dd>
        </Field>
        <Field label={t('executions.progress')}>
          <dd>{t('executions.progressValue', { answered, total })}</dd>
          {requiredMissing > 0 && <dd className="text-destructive text-xs">{t('executions.requiredMissing', { count: requiredMissing })}</dd>}
        </Field>
      </dl>
      {detail && <p className="text-muted-foreground text-xs">{deviceLine(t, summary, detail)}</p>}
    </div>
  );
}

function RejectedExecutions({ items }: { items: ExecutionSummary[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="grid gap-2 border-t pt-3">
      <Button variant="ghost" className="justify-start px-0" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('executions.rejected.title', { count: items.length })}
      </Button>
      {open && (
        <ul className="grid gap-3">
          {items.map((s) => (
            <RejectedExecution key={s.id} summary={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RejectedExecution({ summary }: { summary: ExecutionSummary }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <li aria-label={summary.executor.fullName} className="grid gap-2 rounded-md border p-3">
      <SummaryView summary={summary} />
      {summary.rejectedReason && (
        <p>{t('executions.rejected.reason', { reason: t(`executions.claimRejections.${summary.rejectedReason}`) })}</p>
      )}
      <Button variant="outline" size="sm" className="w-fit" aria-expanded={show} onClick={() => setShow(!show)}>
        {show ? t('executions.rejected.hideAnswers') : t('executions.rejected.showAnswers')}
      </Button>
      {show && <ExecutionAnswers id={summary.id} />}
    </li>
  );
}

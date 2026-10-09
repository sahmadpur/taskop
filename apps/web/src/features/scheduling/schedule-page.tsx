import { addDays, type ExecutionBrief, OCCURRENCE_STATUSES, type OccurrenceDto } from '@taskop/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPercent } from '@/features/executions/labels';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { useMe } from '@/lib/session';
import { formatLocalDate, occurrenceVariant, useTenantToday, useTimeFormat } from './labels';
import { OccurrenceDialog, type OccurrenceTab } from './occurrence-dialog';
import { useOccurrences } from './queries';
import { weekStartOf } from './roster-grid';

export function SchedulePage(props: { initialDate?: string; initialOccurrenceId?: string; initialTab?: OccurrenceTab }) {
  const { t } = useTranslation();
  const today = useTenantToday();
  const time = useTimeFormat();
  const sites = useSites();
  const [view, setView] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState(props.initialDate ?? today);
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  // A link (e.g. from the problems page) may name an occurrence to open right away.
  const [selected, setSelected] = useState<string | null>(props.initialOccurrenceId ?? null);
  const from = view === 'day' ? anchor : weekStartOf(anchor);
  const to = view === 'day' ? anchor : addDays(from, 6);
  const step = view === 'day' ? 1 : 7;
  const occurrences = useOccurrences({ from, to, siteId: siteId || undefined, status: status || undefined });
  const groups = useMemo(() => {
    const byDay = new Map<string, OccurrenceDto[]>();
    for (const o of occurrences.data ?? []) byDay.set(o.localDate, [...(byDay.get(o.localDate) ?? []), o]);
    return [...byDay.entries()];
  }, [occurrences.data]);

  return (
    <div className="grid gap-4">
      <PageHeader title={t('scheduling.schedule.title')} />
      <div className="flex flex-wrap items-center gap-2">
        {(['day', 'week'] as const).map((v) => (
          <Button key={v} variant={view === v ? 'default' : 'outline'} aria-pressed={view === v} onClick={() => setView(v)}>
            {t(`scheduling.schedule.${v}`)}
          </Button>
        ))}
        <Button variant="outline" onClick={() => setAnchor(addDays(anchor, -step))}>
          {t('scheduling.schedule.prev')}
        </Button>
        <Button variant="outline" onClick={() => setAnchor(today)}>
          {t('scheduling.schedule.today')}
        </Button>
        <Button variant="outline" onClick={() => setAnchor(addDays(anchor, step))}>
          {t('scheduling.schedule.next')}
        </Button>
        <span className="text-sm">{from === to ? formatLocalDate(from) : `${formatLocalDate(from)} – ${formatLocalDate(to)}`}</span>
        <NativeSelect aria-label={t('scheduling.schedule.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56">
          <option value="">{t('scheduling.schedule.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('scheduling.schedule.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">{t('scheduling.schedule.allStatuses')}</option>
          {OCCURRENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`scheduling.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {occurrences.error && <p className="text-destructive">{errorText(t, occurrences.error)}</p>}
      {occurrences.isSuccess && groups.length === 0 && <p className="text-muted-foreground">{t('scheduling.schedule.empty')}</p>}
      {groups.map(([date, items]) => (
        <section key={date} aria-label={formatLocalDate(date)} className="grid gap-2">
          <h2 className="font-semibold">{formatLocalDate(date)}</h2>
          <ul className="grid gap-1">
            {items.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setSelected(o.id)}
                  className="hover:bg-muted flex w-full flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-left text-sm"
                >
                  <span className="font-mono">
                    {time(o.startsAt)}–{time(o.dueAt)}
                  </span>
                  <span className="font-medium">{o.checklistName}</span>
                  {o.assignmentName && <span className="text-muted-foreground">{o.assignmentName}</span>}
                  <span className="text-muted-foreground">{o.siteName}</span>
                  <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
                  {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
                  {o.executionBrief && <ExecutionCells brief={o.executionBrief} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {selected && (
        <OccurrenceDialog
          id={selected}
          initialTab={selected === props.initialOccurrenceId ? props.initialTab : undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** The counted execution on a schedule row (spec §8): who, how far, the score, and the flags. */
function ExecutionCells({ brief }: { brief: ExecutionBrief }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  return (
    <>
      <span>{brief.executorName}</span>
      <span title={t('executions.progress')} className="font-mono">
        {t('executions.progressShort', { answered: brief.progress.answered, total: brief.progress.total })}
      </span>
      {brief.scorePercent !== null && (
        <span title={t('executions.score')}>{t('executions.percent', { value: formatPercent(brief.scorePercent, tenant.locale) })}</span>
      )}
      {brief.late && <Badge variant="destructive">{t('executions.flags.late')}</Badge>}
      {brief.clockSuspect && <Badge variant="outline">{t('executions.flags.clockSuspect')}</Badge>}
    </>
  );
}

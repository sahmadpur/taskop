import type { ReportFilters } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OccurrenceTab } from '@/features/scheduling/occurrence-dialog';
import { formatLocalDate, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { useMe } from '@/lib/session';
import { RunDrawer } from './drawers';
import { runPeople } from './labels';
import { useCriticalProblems, useOverdueNow } from './queries';

const ROW = 'hover:bg-muted flex w-full flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-left text-sm';

/**
 * Spec §6.1 "Needs attention": runs overdue right now (today's, decision 9) and the period's critical problems, the
 * first 10 of each. A row opens the run drawer: an overdue run on its overview, a problem on the execution tab.
 */
export function AttentionPanel({ filters, today }: { filters: ReportFilters; today: string }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const time = useTimeFormat();
  const overdue = useOverdueNow(filters, today);
  const critical = useCriticalProblems(filters);
  const [run, setRun] = useState<{ id: string; tab: OccurrenceTab } | null>(null);

  return (
    <section aria-label={t('reports.attention.title')} className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('reports.attention.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.attention.overdueNow')}</CardTitle>
          </CardHeader>
          <CardContent>
            {overdue.error ? (
              <p className="text-destructive text-sm">{errorText(t, overdue.error)}</p>
            ) : !overdue.data ? (
              <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
            ) : overdue.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('reports.attention.noneOverdue')}</p>
            ) : (
              <ul aria-label={t('reports.attention.overdueNow')} className="grid gap-1">
                {overdue.data.map((r) => (
                  <li key={r.occurrenceId}>
                    <button type="button" className={ROW} onClick={() => setRun({ id: r.occurrenceId, tab: 'overview' })}>
                      <span className="font-mono">{time(r.dueAt)}</span>
                      <span className="font-medium">{r.checklist.name}</span>
                      <span className="text-muted-foreground">
                        {r.site.name} · {runPeople(t, r)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.attention.critical')}</CardTitle>
          </CardHeader>
          <CardContent>
            {critical.error ? (
              <p className="text-destructive text-sm">{errorText(t, critical.error)}</p>
            ) : !critical.data ? (
              <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
            ) : critical.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('reports.attention.noneCritical')}</p>
            ) : (
              <ul aria-label={t('reports.attention.critical')} className="grid gap-1">
                {critical.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" className={ROW} onClick={() => setRun({ id: p.occurrenceId, tab: 'execution' })}>
                      <span className="font-medium">{p.itemLabel ?? p.checklistName}</span>
                      <span className="text-muted-foreground">
                        {p.checklistName} · {p.siteName} · {formatLocalDate(p.localDate, tenant.locale)}
                      </span>
                      {p.note && <span className="w-full">{p.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {run && <RunDrawer id={run.id} tab={run.tab} onClose={() => setRun(null)} />}
    </section>
  );
}

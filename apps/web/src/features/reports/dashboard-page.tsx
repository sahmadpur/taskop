import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useTenantToday, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AttentionPanel } from './attention-panel';
import { DASHBOARD_TILES } from './labels';
import { reportKeys, useReportSummary } from './queries';
import { ReportFilters } from './report-filters';
import { reportSearch, resolveReportFilters } from './search';
import { SummaryView } from './summary-view';

/**
 * The web home page for reports.view holders (spec §6.1). Its numbers are live: polled every minute while visible,
 * refreshed on demand. "Today" is read on every render, so a page left open past midnight moves to the new day once
 * the next poll re-renders it (decision 10).
 */
export function DashboardPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const time = useTimeFormat();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const search = reportSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const resolved = resolveReportFilters(search, today);
  const filters = resolved.ok ? resolved.filters : null;
  const summary = useReportSummary(filters, { live: true });

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t('reports.dashboard')}
        actions={
          <>
            {summary.dataUpdatedAt > 0 && (
              <span className="text-muted-foreground self-center text-sm">{t('reports.live.updatedAt', { time: time(new Date(summary.dataUpdatedAt).toISOString()) })}</span>
            )}
            <Button variant="outline" disabled={summary.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: reportKeys.all })}>
              <RefreshCw className={cn('size-4', summary.isFetching && 'animate-spin')} aria-hidden />
              {t('reports.live.refresh')}
            </Button>
          </>
        }
      />
      <ReportFilters value={search} today={today} onChange={(next) => void navigate({ to: '/', search: next, replace: true })} />
      {summary.error && <p className="text-destructive">{errorText(t, summary.error)}</p>}
      {summary.data && filters && <SummaryView summary={summary.data} search={search} filters={filters} tiles={DASHBOARD_TILES} />}
      {filters && <AttentionPanel filters={filters} today={today} />}
    </div>
  );
}

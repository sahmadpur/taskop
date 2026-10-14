import type { ReportFilters, ReportSummary } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/lib/errors';
import { CountTiles } from './count-tiles';
import { isSingleDay, SUMMARY_TILES, type TileKey } from './labels';
import { useReportSummary } from './queries';
import type { ReportSearch } from './search';
import { TrendChart } from './trend-chart';

/** Tiles and trend: the dashboard and the Summary tab show the same components (spec §6.2). */
export function SummaryView({ summary, search, filters, tiles }: { summary: ReportSummary; search: ReportSearch; filters: ReportFilters; tiles: readonly TileKey[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <CountTiles summary={summary} search={search} keys={tiles} />
      {summary.counts.planned === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
      {!isSingleDay(filters) && <TrendChart trend={summary.trend} />}
    </div>
  );
}

export function SummaryTab({ search, filters }: { search: ReportSearch; filters: ReportFilters }) {
  const { t } = useTranslation();
  const summary = useReportSummary(filters);
  if (summary.error) return <p className="text-destructive">{errorText(t, summary.error)}</p>;
  if (!summary.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return <SummaryView summary={summary.data} search={search} filters={filters} tiles={SUMMARY_TILES} />;
}

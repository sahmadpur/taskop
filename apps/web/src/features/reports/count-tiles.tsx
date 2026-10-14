import type { ReportSummary } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/session';
import { cn } from '@/lib/utils';
import { percentText, type TileKey, tileSearch } from './labels';
import type { ReportSearch } from './search';

const TILE = 'grid content-start gap-1 rounded-lg border p-4';

/**
 * Spec §6.1: one link per count to `/reports?tab=runs&bucket=…` with the same filters, then completion % and average
 * score. A link is named "label: value", so the number is part of what a screen reader announces.
 */
export function CountTiles({ summary, search, keys }: { summary: ReportSummary; search: ReportSearch; keys: readonly TileKey[] }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const hintId = useId();
  const count = new Intl.NumberFormat(intlLocale(tenant.locale));
  const completion = t('reports.measures.completionPercent');
  const average = t('reports.measures.averageScore');
  const hint = t('reports.measures.completionHint');
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {keys.map((key) => {
        const label = t(`reports.counts.${key}`);
        const value = count.format(summary.counts[key]);
        return (
          <Link
            key={key}
            to="/reports"
            search={tileSearch(search, key)}
            aria-label={t('reports.tiles.link', { label, value })}
            className={cn(TILE, 'hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none')}
          >
            <span className="text-muted-foreground text-sm">{label}</span>
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
          </Link>
        );
      })}
      <div role="group" aria-label={completion} aria-describedby={hintId} className={TILE}>
        <span className="text-muted-foreground flex items-center gap-1 text-sm">
          {completion}
          {/* No tooltip component in the repo: the title shows on hover, the description reaches screen readers (decision 7). */}
          <span title={hint} className="inline-flex">
            <Info className="size-3.5" aria-hidden />
          </span>
        </span>
        <span className="text-2xl font-semibold tabular-nums">{percentText(t, summary.completionPercent, tenant.locale)}</span>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </div>
      <div role="group" aria-label={average} className={TILE}>
        <span className="text-muted-foreground text-sm">{average}</span>
        <span className="text-2xl font-semibold tabular-nums">{percentText(t, summary.averageScore, tenant.locale)}</span>
      </div>
    </div>
  );
}

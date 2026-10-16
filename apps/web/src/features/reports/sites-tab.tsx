import type { ReportFilters } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { errorText } from '@/lib/errors';
import { ComparisonTable } from './comparison-table';
import { useSiteReport } from './queries';
import { LoadingState, EmptyState } from '@/components/states';

/** Spec §6.2 "Sites": tree order, the parent path under the name, inactive sites marked; a row drills down. */
export function SitesTab({ filters, onDrill }: { filters: ReportFilters; onDrill: (siteId: string) => void }) {
  const { t } = useTranslation();
  const sites = useSiteReport(filters);
  if (sites.error) return <p className="text-destructive">{errorText(t, sites.error)}</p>;
  if (!sites.data) return <LoadingState />;
  if (sites.data.length === 0) return <EmptyState title={t('reports.empty')} />;
  return (
    <ComparisonTable
      rows={sites.data}
      nameLabel={t('reports.columns.site')}
      rowKey={(r) => r.siteId}
      renderName={(r) => (
        <div className="grid">
          <span className="flex items-center gap-2">
            <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => onDrill(r.siteId)}>
              {r.name}
            </button>
            {!r.active && <Badge variant="outline">{t('reports.inactive')}</Badge>}
          </span>
          {r.path.length > 0 && <span className="text-muted-foreground text-xs">{r.path.join(' › ')}</span>}
        </div>
      )}
    />
  );
}

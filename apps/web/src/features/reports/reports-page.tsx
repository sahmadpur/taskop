import { REPORT_KINDS, type ReportFilters as Filters, type ReportKind } from '@taskop/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenantToday } from '@/features/scheduling/labels';
import { ReportFilters } from './report-filters';
import { DEFAULT_TAB, filterSearch, pageExtras, type ReportsPageSearch, reportsPageSearch, resolveReportFilters } from './search';
import { SummaryTab } from './summary-view';

type Go = (next: ReportsPageSearch, replace?: boolean) => void;

/**
 * `/reports` (spec §6.2): the filter bar, then one tab per report. Filters, tab, bucket and severity live in the URL,
 * so a URL is a shareable report. Only the open tab is mounted, so only its report is asked for.
 */
export function ReportsPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const search = reportsPageSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const tab = search.tab ?? DEFAULT_TAB;
  const resolved = resolveReportFilters(search, today);
  const filters = resolved.ok ? resolved.filters : null;
  // Filter edits replace the history entry; tabs, chips and drill-downs push one (decision 3).
  const go: Go = (next, replace = false) => void navigate({ to: '/reports', search: next, replace });

  return (
    <div className="grid gap-4">
      <PageHeader title={t('reports.title')} />
      <ReportFilters value={filterSearch(search)} today={today} onChange={(next) => go({ ...next, ...pageExtras(search) }, true)} />
      <Tabs value={tab} onValueChange={(v) => go({ ...search, tab: v as ReportKind })}>
        <TabsList>
          {REPORT_KINDS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`reports.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {REPORT_KINDS.map((k) => (
          <TabsContent key={k} value={k} className="pt-2">
            {filters && <TabBody kind={k} search={search} filters={filters} go={go} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** The open tab's report. Tasks 7 and 8 add the other tabs. */
function TabBody({ kind, search, filters }: { kind: ReportKind; search: ReportsPageSearch; filters: Filters; go: Go }) {
  switch (kind) {
    case 'summary':
      return <SummaryTab search={filterSearch(search)} filters={filters} />;
    default:
      return null;
  }
}

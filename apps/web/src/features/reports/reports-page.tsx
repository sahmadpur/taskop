import { REPORT_KINDS, type ReportFilters as Filters, type ReportKind } from '@taskop/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenantToday } from '@/features/scheduling/labels';
import { EmployeesTab } from './employees-tab';
import { ExportMenu } from './export-menu';
import { ProblemsTab } from './problems-tab';
import { ReportFilters } from './report-filters';
import { RunsTab } from './runs-tab';
import { cleanSearch, DEFAULT_BUCKET, DEFAULT_TAB, filterSearch, pageExtras, type ReportsPageSearch, reportsPageSearch, resolveReportFilters } from './search';
import { SitesTab } from './sites-tab';
import { SummaryTab } from './summary-view';
import { TasksTab } from './tasks-tab';

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
      <PageHeader
        title={t('reports.title')}
        actions={
          <ExportMenu
            kind={tab}
            filters={filters}
            bucket={tab === 'runs' ? (search.bucket ?? DEFAULT_BUCKET) : undefined}
            severity={tab === 'problems' ? search.severity : undefined}
            auditState={tab === 'runs' ? search.auditState : undefined}
          />
        }
      />
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

/** The open tab's report. Chips push a history entry, like tabs (decision 3). */
function TabBody({ kind, search, filters, go }: { kind: ReportKind; search: ReportsPageSearch; filters: Filters; go: Go }): ReactNode {
  switch (kind) {
    case 'summary':
      return <SummaryTab search={filterSearch(search)} filters={filters} />;
    case 'sites':
      // A row narrows the report to that site and its zones, on Summary (spec §6.2).
      return <SitesTab filters={filters} onDrill={(siteId) => go({ ...search, siteId, tab: 'summary' })} />;
    case 'employees':
      return <EmployeesTab filters={filters} onDrill={(userId) => go({ ...search, userId, tab: 'summary' })} />;
    case 'runs':
      return (
        <RunsTab
          filters={filters}
          bucket={search.bucket ?? DEFAULT_BUCKET}
          onBucket={(bucket) => go({ ...search, bucket })}
          auditState={search.auditState ?? null}
          onAuditState={(auditState) => go(cleanSearch({ ...search, auditState: auditState ?? undefined }))}
        />
      );
    case 'problems':
      return <ProblemsTab filters={filters} severity={search.severity ?? null} onSeverity={(severity) => go(cleanSearch({ ...search, severity: severity ?? undefined }))} />;
    case 'tasks':
      return <TasksTab filters={filters} />;
  }
}

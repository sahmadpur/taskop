import { PROBLEM_SEVERITIES, type ProblemSeverity, type ReportFilters } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { severityVariant } from '@/features/executions/labels';
import { formatLocalDate } from '@/features/scheduling/labels';
import { resolutionVariant } from '@/features/tasks/labels';
import { errorText } from '@/lib/errors';
import { useMe } from '@/lib/session';
import { ChipGroup } from './chip-group';
import { ReportTaskDrawer, RunDrawer } from './drawers';
import { useReportProblems } from './queries';
import { StatList } from './stat-list';

const COLUMNS = ['date', 'item', 'checklist', 'site', 'severity', 'source', 'note', 'executor', 'resolution'] as const;
type SeverityChip = ProblemSeverity | 'all';

/**
 * Spec §6.2 "Problems": counts by severity and resolution (over the whole filtered set), severity chips and a paged
 * list. A row opens its run on the execution tab (decision 13); the linked task opens the task drawer.
 */
export function ProblemsTab({ filters, severity, onSeverity }: { filters: ReportFilters; severity: ProblemSeverity | null; onSeverity: (s: ProblemSeverity | null) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const problems = useReportProblems(filters, severity);
  const [run, setRun] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const counts = problems.data?.pages[0]?.counts;
  const items = problems.data?.pages.flatMap((p) => p.items) ?? [];
  const chips: { value: SeverityChip; label: string }[] = [
    { value: 'all', label: t('common.all') },
    ...PROBLEM_SEVERITIES.map((s) => ({ value: s, label: t(`executions.severities.${s}`) })),
  ];

  return (
    <div className="grid gap-4">
      {counts && (
        <StatList
          label={t('reports.tabs.problems')}
          items={[
            { label: t('reports.problems.total'), value: counts.total },
            { label: t('reports.problems.critical'), value: counts.critical },
            ...(['none', 'open', 'resolved', 'cancelled'] as const).map((r) => ({ label: t(`tasks.resolutions.${r}`), value: counts.resolution[r] })),
          ]}
        />
      )}
      <ChipGroup label={t('reports.filters.severity')} options={chips} value={severity ?? 'all'} onChange={(v) => onSeverity(v === 'all' ? null : v)} />
      {problems.error && <p className="text-destructive">{errorText(t, problems.error)}</p>}
      {problems.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {problems.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`reports.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatLocalDate(p.localDate, tenant.locale)}</TableCell>
                <TableCell>
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setRun(p.occurrenceId)}>
                    {p.itemLabel ?? p.checklistName}
                  </button>
                </TableCell>
                <TableCell>{p.checklistName}</TableCell>
                <TableCell>{p.siteName}</TableCell>
                <TableCell>
                  <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                </TableCell>
                <TableCell>{t(`executions.problemSources.${p.source}`)}</TableCell>
                <TableCell className="max-w-64 whitespace-pre-wrap">{p.note ?? t('reports.noValue')}</TableCell>
                <TableCell>{p.executorName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={resolutionVariant(p.resolution)}>{t(`tasks.resolutions.${p.resolution}`)}</Badge>
                    {p.taskId && (
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setTask(p.taskId)}>
                        {t('reports.table.openTask')}
                        {p.taskStatus && ` · ${t(`tasks.statuses.${p.taskStatus}`)}`}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {problems.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={problems.isFetchingNextPage} onClick={() => void problems.fetchNextPage()}>
          {t('reports.table.more')}
        </Button>
      )}
      {run && <RunDrawer id={run} tab="execution" onClose={() => setRun(null)} />}
      {task && <ReportTaskDrawer id={task} onClose={() => setTask(null)} />}
    </div>
  );
}

import { type ReportFilters, TASK_STATUSES } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { assigneeText, taskStatusVariant } from '@/features/tasks/labels';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { ReportTaskDrawer } from './drawers';
import { useReportTasks } from './queries';
import { StatList } from './stat-list';
import { LoadingState, EmptyState } from '@/components/states';

const COLUMNS = ['title', 'status', 'priority', 'assignee', 'site', 'due', 'completed'] as const;

/** Spec §6.2 "Tasks": counts by status, on time against late (spec §3.4), and a paged list; a row opens the task drawer. */
export function TasksTab({ filters }: { filters: ReportFilters }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const tasks = useReportTasks(filters);
  const [open, setOpen] = useState<string | null>(null);
  const counts = tasks.data?.pages[0]?.counts;
  const items = tasks.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      {counts && (
        <StatList
          label={t('reports.tabs.tasks')}
          items={[
            ...TASK_STATUSES.map((s) => ({ label: t(`tasks.statuses.${s}`), value: counts.byStatus[s] })),
            { label: t('reports.tasks.overdueOpen'), value: counts.overdueOpen },
            { label: t('reports.tasks.completedOnTime'), value: counts.completedOnTime },
            { label: t('reports.tasks.completedLate'), value: counts.completedLate },
          ]}
        />
      )}
      {tasks.error && <p className="text-destructive">{errorText(t, tasks.error)}</p>}
      {tasks.isPending && <LoadingState />}
      {tasks.isSuccess && items.length === 0 && <EmptyState title={t('reports.empty')} />}
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
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setOpen(r.id)}>
                    {r.title}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={taskStatusVariant(r.status)}>{t(`tasks.statuses.${r.status}`)}</Badge>
                    {r.overdue && <Badge variant="destructive">{t('tasks.flags.overdue')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{t(`tasks.priorities.${r.priority}`)}</TableCell>
                <TableCell>{assigneeText(t, r)}</TableCell>
                <TableCell>{r.site?.name ?? t('reports.noValue')}</TableCell>
                <TableCell>{r.dueAt ? formatDateTime(r.dueAt) : t('reports.noValue')}</TableCell>
                <TableCell>{r.completedAt ? formatDateTime(r.completedAt) : t('reports.noValue')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {tasks.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>
          {t('reports.table.more')}
        </Button>
      )}
      {open && <ReportTaskDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

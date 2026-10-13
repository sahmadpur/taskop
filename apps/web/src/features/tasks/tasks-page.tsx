import { TASK_SOURCES, TASK_STATUSES, type TaskSource, type TaskStatus } from '@taskop/contracts';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { AssigneePicker } from './assignee-picker';
import { assigneeText, dueRangeInverted, EMPTY_TASK_FILTERS, TASK_TABS, type TaskFilters, type TaskTab, taskListQuery, taskStatusVariant } from './labels';
import { useTasks } from './queries';
import type { TasksSearch } from './routes';
import { TaskDialog } from './task-dialog';
import { TaskDrawer } from './task-drawer';

const COLUMNS = ['title', 'status', 'assignee', 'site', 'due', 'source'] as const;

/** Spec §8: every task the caller can read, by tab and filters; `?task=<id>` opens its drawer. */
export function TasksPage() {
  const { t } = useTranslation();
  const me = useMe();
  const formatDateTime = useFormatDateTime();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as TasksSearch;
  const canManage = me.permissions.includes('tasks.manage');
  const canSeeSites = useCan('sites.view');
  const sites = useSites(canSeeSites);
  const [tab, setTab] = useState<TaskTab>('all');
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  const [creating, setCreating] = useState(false);
  const inverted = dueRangeInverted(filters);
  const tasks = useTasks(taskListQuery(tab, filters, { userId: me.user.id, timeZone: me.tenant.timezone }), !inverted);
  const items = tasks.data?.pages.flatMap((p) => p.items) ?? [];
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const openTask = (id: string | null) => void navigate({ to: '/tasks', search: id ? { task: id } : {} });

  return (
    <div className="grid gap-4">
      <PageHeader title={t('tasks.page.title')} actions={canManage && <Button onClick={() => setCreating(true)}>{t('tasks.page.new')}</Button>} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TaskTab)}>
        <TabsList>
          {TASK_TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tasks.page.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-end gap-3">
        <NativeSelect aria-label={t('tasks.page.status')} value={filters.status} onChange={(e) => set('status', e.target.value as TaskStatus | '')} className="w-48">
          <option value="">{t('tasks.page.allStatuses')}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
        {canSeeSites && (
          <NativeSelect aria-label={t('tasks.page.site')} value={filters.siteId} onChange={(e) => set('siteId', e.target.value)} className="w-52">
            <option value="">{t('tasks.page.allSites')}</option>
            {(sites.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {canManage && (
          <div className="w-64">
            <AssigneePicker label={t('tasks.page.assignee')} value={filters.assignee} onChange={(c) => set('assignee', c)} clearable />
          </div>
        )}
        <NativeSelect aria-label={t('tasks.page.source')} value={filters.source} onChange={(e) => set('source', e.target.value as TaskSource | '')} className="w-44">
          <option value="">{t('tasks.page.allSources')}</option>
          {TASK_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.sources.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <div className="grid gap-1">
          <Label htmlFor="tasks-due-from">{t('tasks.page.dueFrom')}</Label>
          <Input id="tasks-due-from" type="date" value={filters.dueFrom} onChange={(e) => set('dueFrom', e.target.value)} className="w-44" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tasks-due-to">{t('tasks.page.dueTo')}</Label>
          <Input id="tasks-due-to" type="date" value={filters.dueTo} onChange={(e) => set('dueTo', e.target.value)} className="w-44" />
        </div>
      </div>
      {inverted && <p className="text-destructive text-sm">{t('tasks.page.dueRangeInverted')}</p>}
      {!inverted && tasks.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {!inverted && tasks.error && <p className="text-destructive">{errorText(t, tasks.error)}</p>}
      {!inverted && tasks.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('tasks.page.empty')}</p>}
      {!inverted && items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`tasks.page.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link to="/tasks" search={{ task: s.id }} className="font-medium underline-offset-4 hover:underline">
                    {s.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={taskStatusVariant(s.status)}>{t(`tasks.statuses.${s.status}`)}</Badge>
                    {s.overdueAt && <Badge variant="destructive">{t('tasks.flags.overdue')}</Badge>}
                    {s.assigneeInactive && <Badge variant="outline">{t('tasks.flags.assigneeInactive')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{assigneeText(t, s)}</TableCell>
                <TableCell>{s.site?.name ?? '—'}</TableCell>
                <TableCell>{s.dueAt ? formatDateTime(s.dueAt) : '—'}</TableCell>
                <TableCell>{t(`tasks.sources.${s.source}`)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!inverted && tasks.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>
          {t('tasks.page.more')}
        </Button>
      )}
      {search.task && <TaskDrawer key={search.task} id={search.task} onClose={() => openTask(null)} />}
      {creating && <TaskDialog onClose={() => setCreating(false)} onSaved={(task) => openTask(task.id)} />}
    </div>
  );
}

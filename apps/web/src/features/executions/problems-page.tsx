import {
  PROBLEM_RESOLUTIONS,
  PROBLEM_SEVERITIES,
  PROBLEM_SOURCES,
  type ProblemDto,
  type ProblemResolution,
  type ProblemSeverity,
  type ProblemSource,
} from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatLocalDate, useTenantToday } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { resolutionVariant } from '@/features/tasks/labels';
import { TaskDialog } from '@/features/tasks/task-dialog';
import { errorText } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { defaultProblemRange, problemRangeError, severityVariant } from './labels';
import { type ProblemFilters, useChecklistOptions, useProblems } from './queries';

/**
 * Recorded problems (spec §8 of SP4 and SP5). Each row opens its occurrence in the schedule drawer on the "İcra" tab;
 * its resolution links to its task, or offers to create one once the run is closed.
 */
export function ProblemsPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const canManageTasks = useCan('tasks.manage');
  const sites = useSites();
  const checklists = useChecklistOptions();
  const [range, setRange] = useState(() => defaultProblemRange(today));
  const [siteId, setSiteId] = useState('');
  const [checklistId, setChecklistId] = useState('');
  const [severity, setSeverity] = useState<ProblemSeverity | ''>('');
  const [source, setSource] = useState<ProblemSource | ''>('');
  const [resolution, setResolution] = useState<ProblemResolution | ''>('');
  const [creatingFrom, setCreatingFrom] = useState<ProblemDto | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const rangeError = problemRangeError(range.from, range.to);
  const filters: ProblemFilters = {
    from: range.from,
    to: range.to,
    siteId: siteId || undefined,
    checklistId: checklistId || undefined,
    severity: severity || undefined,
    source: source || undefined,
    resolution: resolution || undefined,
    // Part 1 decision 18: cleared problems are skipped unless asked for.
    ...(showCleared ? { includeCleared: 'true' } : {}),
  };
  const problems = useProblems(filters, rangeError === null);
  const items = problems.data?.pages.flatMap((p) => p.items) ?? [];
  const c = (key: string) => t(`executions.problemsPage.columns.${key}`);

  return (
    <div className="grid gap-4">
      <PageHeader title={t('executions.problemsPage.title')} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="problems-from">{t('executions.problemsPage.from')}</Label>
          <Input id="problems-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-44" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="problems-to">{t('executions.problemsPage.to')}</Label>
          <Input id="problems-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-44" />
        </div>
        <NativeSelect aria-label={t('executions.problemsPage.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-52">
          <option value="">{t('executions.problemsPage.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('executions.problemsPage.severity')}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as ProblemSeverity | '')}
          className="w-44"
        >
          <option value="">{t('executions.problemsPage.allSeverities')}</option>
          {PROBLEM_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`executions.severities.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('executions.problemsPage.checklist')} value={checklistId} onChange={(e) => setChecklistId(e.target.value)} className="w-56">
          <option value="">{t('executions.problemsPage.allChecklists')}</option>
          {(checklists.data ?? []).map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('executions.problemsPage.source')}
          value={source}
          onChange={(e) => setSource(e.target.value as ProblemSource | '')}
          className="w-44"
        >
          <option value="">{t('executions.problemsPage.allSources')}</option>
          {PROBLEM_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`executions.problemSources.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('tasks.problems.resolution')}
          value={resolution}
          onChange={(e) => setResolution(e.target.value as ProblemResolution | '')}
          className="w-44"
        >
          <option value="">{t('tasks.problems.allResolutions')}</option>
          {PROBLEM_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`tasks.resolutions.${r}`)}
            </option>
          ))}
        </NativeSelect>
        <div className="flex h-9 items-center gap-2">
          <Checkbox id="problems-show-cleared" checked={showCleared} onCheckedChange={(c) => setShowCleared(c === true)} />
          <Label htmlFor="problems-show-cleared" className="font-normal">
            {t('corrections.web.showCleared')}
          </Label>
        </div>
      </div>
      {rangeError && <p className="text-destructive text-sm">{t(rangeError)}</p>}
      {!rangeError && problems.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {!rangeError && problems.error && <p className="text-destructive">{errorText(t, problems.error)}</p>}
      {!rangeError && problems.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('executions.problemsPage.empty')}</p>}
      {!rangeError && items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {['date', 'site', 'checklist', 'item', 'severity', 'source', 'note', 'executor', 'media'].map((k) => (
                <TableHead key={k}>{c(k)}</TableHead>
              ))}
              <TableHead>{t('tasks.problems.resolution')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} data-cleared={p.clearedAt ? 'true' : undefined} className={p.clearedAt ? 'opacity-60' : undefined}>
                <TableCell>{formatLocalDate(p.localDate)}</TableCell>
                <TableCell>{p.siteName}</TableCell>
                <TableCell>{p.checklistName}</TableCell>
                <TableCell>
                  <Link
                    to="/schedule"
                    search={{ date: p.localDate, occurrence: p.occurrenceId, tab: 'execution' }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.itemLabel ?? t('executions.problemsPage.unknownItem')}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                    {p.clearedAt && <Badge variant="outline">{t('corrections.cleared')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{t(`executions.problemSources.${p.source}`)}</TableCell>
                <TableCell className="max-w-xs whitespace-pre-line">{p.note ?? '—'}</TableCell>
                <TableCell>{p.executorName}</TableCell>
                <TableCell>{p.mediaIds.length ? t('executions.problemsPage.mediaCount', { count: p.mediaIds.length }) : '—'}</TableCell>
                <TableCell>
                  <ResolutionCell problem={p} canCreate={canManageTasks} onCreate={() => setCreatingFrom(p)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!rangeError && problems.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={problems.isFetchingNextPage} onClick={() => void problems.fetchNextPage()}>
          {t('executions.problemsPage.more')}
        </Button>
      )}
      {/* Saving invalidates ['problems'] (storeTask), so the row then shows its open task. */}
      {creatingFrom && <TaskDialog problem={creatingFrom} onClose={() => setCreatingFrom(null)} />}
    </div>
  );
}

function ResolutionCell({ problem: p, canCreate, onCreate }: { problem: ProblemDto; canCreate: boolean; onCreate: () => void }) {
  const { t } = useTranslation();
  if (p.taskId) {
    return (
      <Badge asChild variant={resolutionVariant(p.resolution)}>
        <Link to="/tasks" search={{ task: p.taskId }}>
          {t(`tasks.resolutions.${p.resolution}`)}
        </Link>
      </Badge>
    );
  }
  if (!canCreate) return <Badge variant="outline">{t('tasks.resolutions.none')}</Badge>;
  // PROBLEM_NOT_CLOSED: only a completed or partial run's problems are frozen and can get a task (spec §1; ruling W5).
  const runOpen = !(p.executionState === 'completed' || p.executionState === 'partial');
  return (
    <span title={runOpen ? t('tasks.problems.runOpen') : undefined} className="inline-block">
      <Button size="sm" variant="outline" disabled={runOpen} onClick={onCreate}>
        {t('tasks.problems.create')}
      </Button>
    </span>
  );
}

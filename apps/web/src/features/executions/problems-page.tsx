import { PROBLEM_SEVERITIES, PROBLEM_SOURCES, type ProblemSeverity, type ProblemSource } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatLocalDate, useTenantToday } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { defaultProblemRange, problemRangeError, severityVariant } from './labels';
import { type ProblemFilters, useChecklistOptions, useProblems } from './queries';

/** Recorded problems, read-only (spec §8). Each row opens its occurrence in the schedule drawer on the "İcra" tab. */
export function ProblemsPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const sites = useSites();
  const checklists = useChecklistOptions();
  const [range, setRange] = useState(() => defaultProblemRange(today));
  const [siteId, setSiteId] = useState('');
  const [checklistId, setChecklistId] = useState('');
  const [severity, setSeverity] = useState<ProblemSeverity | ''>('');
  const [source, setSource] = useState<ProblemSource | ''>('');
  const rangeError = problemRangeError(range.from, range.to);
  const filters: ProblemFilters = {
    from: range.from,
    to: range.to,
    siteId: siteId || undefined,
    checklistId: checklistId || undefined,
    severity: severity || undefined,
    source: source || undefined,
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
      </div>
      {rangeError && <p className="text-destructive text-sm">{t(rangeError)}</p>}
      {!rangeError && problems.error && <p className="text-destructive">{errorText(t, problems.error)}</p>}
      {!rangeError && problems.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('executions.problemsPage.empty')}</p>}
      {!rangeError && items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {['date', 'site', 'checklist', 'item', 'severity', 'source', 'note', 'executor', 'media'].map((k) => (
                <TableHead key={k}>{c(k)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
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
                  <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                </TableCell>
                <TableCell>{t(`executions.problemSources.${p.source}`)}</TableCell>
                <TableCell className="max-w-xs whitespace-pre-line">{p.note ?? '—'}</TableCell>
                <TableCell>{p.executorName}</TableCell>
                <TableCell>{p.mediaIds.length ? t('executions.problemsPage.mediaCount', { count: p.mediaIds.length }) : '—'}</TableCell>
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
    </div>
  );
}

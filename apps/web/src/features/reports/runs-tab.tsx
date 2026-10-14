import { type ReportFilters, RUN_BUCKETS, type RunBucket } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { receiptDiffers } from '@/features/executions/labels';
import { formatLocalDate, occurrenceVariant, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { ChipGroup } from './chip-group';
import { RunDrawer } from './drawers';
import { percentText, runPeople } from './labels';
import { useReportRuns } from './queries';

const COLUMNS = ['date', 'dueAt', 'checklist', 'site', 'status', 'executor', 'completedAt', 'score', 'problemCount'] as const;

/**
 * Spec §6.2 "Runs": bucket chips and a paged list; a row opens the run drawer. Device times with the server receipt
 * beside them when a late sync makes them differ (FR-10.14); the late and clock-suspect flags are shown (spec §8).
 */
export function RunsTab({ filters, bucket, onBucket }: { filters: ReportFilters; bucket: RunBucket; onBucket: (bucket: RunBucket) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const time = useTimeFormat();
  const formatDateTime = useFormatDateTime();
  const runs = useReportRuns(filters, bucket);
  const [open, setOpen] = useState<string | null>(null);
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      <ChipGroup label={t('reports.filters.bucket')} options={RUN_BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))} value={bucket} onChange={onBucket} />
      {runs.error && <p className="text-destructive">{errorText(t, runs.error)}</p>}
      {runs.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {runs.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
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
              <TableRow key={r.occurrenceId}>
                <TableCell>{formatLocalDate(r.localDate, tenant.locale)}</TableCell>
                <TableCell className="font-mono">{time(r.dueAt)}</TableCell>
                <TableCell>
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setOpen(r.occurrenceId)}>
                    {r.checklist.name}
                  </button>
                </TableCell>
                <TableCell>{r.site.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={occurrenceVariant(r.status)}>{t(`scheduling.statuses.${r.status}`)}</Badge>
                    {r.late && <Badge variant="destructive">{t('executions.flags.late')}</Badge>}
                    {r.clockSuspect && <Badge variant="outline">{t('executions.flags.clockSuspect')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{runPeople(t, r)}</TableCell>
                <TableCell>
                  {r.completedAt ? (
                    <div className="grid">
                      <span>{formatDateTime(r.completedAt)}</span>
                      {r.completedReceivedAt && receiptDiffers(r.completedAt, r.completedReceivedAt) && (
                        <span className="text-muted-foreground text-xs">{t('reports.table.receivedAt', { time: formatDateTime(r.completedReceivedAt) })}</span>
                      )}
                    </div>
                  ) : (
                    t('reports.noValue')
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{percentText(t, r.score, tenant.locale)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1 tabular-nums">
                    {r.problemCount}
                    {r.criticalCount > 0 && <Badge variant="destructive">{`${t('executions.severities.critical')}: ${r.criticalCount}`}</Badge>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {runs.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
          {t('reports.table.more')}
        </Button>
      )}
      {open && <RunDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

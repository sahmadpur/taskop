import { type ReportFilters, RUN_AUDIT_STATES, RUN_BUCKETS, type RunAuditState, type RunBucket } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { runAuditStateVariant } from '@/features/audits/labels';
import { receiptDiffers } from '@/features/executions/labels';
import { formatLocalDate, occurrenceVariant, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { ChipGroup } from './chip-group';
import { RunDrawer } from './drawers';
import { percentText, runPeople } from './labels';
import { useReportRuns } from './queries';
import { useLocale } from '@/lib/i18n';
import { LoadingState, EmptyState } from '@/components/states';

const COLUMNS = ['date', 'dueAt', 'checklist', 'site', 'status', 'executor', 'completedAt', 'score', 'problemCount'] as const;

/**
 * Spec §6.2 "Runs": bucket chips and a paged list; a row opens the run drawer. Device times with the server receipt
 * beside them when a late sync makes them differ (FR-10.14); the late and clock-suspect flags are shown (spec §8).
 */
export function RunsTab({
  filters,
  bucket,
  onBucket,
  auditState = null,
  onAuditState,
}: {
  filters: ReportFilters;
  bucket: RunBucket;
  onBucket: (bucket: RunBucket) => void;
  /** SP8: the audit state filter; without `onAuditState` the select is not shown. */
  auditState?: RunAuditState | null;
  onAuditState?: (state: RunAuditState | null) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const time = useTimeFormat();
  const formatDateTime = useFormatDateTime();
  const runs = useReportRuns(filters, bucket, auditState);
  const [open, setOpen] = useState<string | null>(null);
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipGroup label={t('reports.filters.bucket')} options={RUN_BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))} value={bucket} onChange={onBucket} />
        {onAuditState && (
          <NativeSelect
            aria-label={t('audits.audit')}
            value={auditState ?? ''}
            onChange={(e) => onAuditState((e.target.value || null) as RunAuditState | null)}
            className="w-44"
          >
            <option value="">{t('common.all')}</option>
            {RUN_AUDIT_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`audits.runAuditStates.${s}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {runs.error && <p className="text-destructive">{errorText(t, runs.error)}</p>}
      {runs.isPending && <LoadingState />}
      {runs.isSuccess && items.length === 0 && <EmptyState title={t('reports.empty')} />}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`reports.columns.${k}`)}</TableHead>
              ))}
              <TableHead>{t('audits.audit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.occurrenceId}>
                <TableCell>{formatLocalDate(r.localDate, locale)}</TableCell>
                <TableCell className="tabular-nums">{time(r.dueAt)}</TableCell>
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
                <TableCell className="tabular-nums">
                  <span className="flex flex-wrap items-center gap-1">
                    {percentText(t, r.score, locale)}
                    {r.corrected && <Badge variant="outline">{t('corrections.corrected')}</Badge>}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1 tabular-nums">
                    {r.problemCount}
                    {r.criticalCount > 0 && <Badge variant="destructive">{`${t('executions.severities.critical')}: ${r.criticalCount}`}</Badge>}
                  </span>
                </TableCell>
                <TableCell>{r.auditState ? <Badge variant={runAuditStateVariant(r.auditState)}>{t(`audits.runAuditStates.${r.auditState}`)}</Badge> : t('reports.noValue')}</TableCell>
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

import { AUDIT_QUEUES, AUDIT_RESULTS, type AuditQueue, type AuditQueueRow } from '@taskop/contracts';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPercent } from '@/features/executions/labels';
import { useReportChecklistOptions } from '@/features/reports/queries';
import { cleanSearch } from '@/features/reports/search';
import { formatLocalDate } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { actorName, type AuditsSearch, auditsSearch, DEFAULT_QUEUE, queueFilters, queueRangeIssue, RANGE_ISSUE_KEYS, resultVariant } from './labels';
import { useAuditorOptions, useAuditQueue, useStartAudit } from './queries';

type Column = 'date' | 'checklist' | 'site' | 'executor' | 'completedAt' | 'auditor' | 'startedAt' | 'status' | 'finishedAt' | 'result' | 'score';
const COLUMNS: Record<AuditQueue, readonly Column[]> = {
  waiting: ['date', 'checklist', 'site', 'executor', 'completedAt'],
  in_progress: ['date', 'checklist', 'site', 'executor', 'auditor', 'startedAt', 'status'],
  finished: ['date', 'checklist', 'site', 'executor', 'auditor', 'finishedAt', 'result', 'score'],
};

/**
 * `/audits` (spec §8.3): Waiting, In progress and Finished, with site, checklist, auditor, result and date filters, all in
 * the URL (decision 2). A waiting row starts its audit; the others open theirs.
 */
export function AuditsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canSites = useCan('sites.view');
  const canChecklists = useCan('checklists.view');
  const canUsers = useCan('users.view');
  const search = auditsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const queue = search.queue ?? DEFAULT_QUEUE;
  const issue = queueRangeIssue(search.from, search.to);
  const rows = useAuditQueue(queueFilters(search), issue === null);
  const sites = useSites(canSites);
  const checklists = useReportChecklistOptions(canChecklists);
  const auditors = useAuditorOptions(canUsers && queue !== 'waiting');
  const items = rows.data?.pages.flatMap((p) => p.items) ?? [];
  // Filter edits replace the history entry; tab switches push one (decision 2).
  const go = (next: AuditsSearch, replace = true) => void navigate({ to: '/audits', search: cleanSearch(next), replace });
  const set = (key: 'siteId' | 'checklistId' | 'auditorId' | 'result' | 'from' | 'to', value: string) => go({ ...search, [key]: value || undefined });

  return (
    <div className="grid gap-4">
      <PageHeader title={t('audits.title')} />
      <div className="flex flex-wrap items-end gap-3">
        {canSites && (
          <NativeSelect aria-label={t('audits.web.page.filters.site')} value={search.siteId ?? ''} onChange={(e) => set('siteId', e.target.value)} className="w-52">
            <option value="">{t('audits.web.page.filters.allSites')}</option>
            {(sites.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {indentedName(s)}
              </option>
            ))}
          </NativeSelect>
        )}
        {canChecklists && (
          <NativeSelect aria-label={t('audits.web.page.filters.checklist')} value={search.checklistId ?? ''} onChange={(e) => set('checklistId', e.target.value)} className="w-56">
            <option value="">{t('audits.web.page.filters.allChecklists')}</option>
            {(checklists.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {canUsers && queue !== 'waiting' && (
          <NativeSelect aria-label={t('audits.web.page.filters.auditor')} value={search.auditorId ?? ''} onChange={(e) => set('auditorId', e.target.value)} className="w-52">
            <option value="">{t('audits.web.page.filters.allAuditors')}</option>
            {(auditors.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </NativeSelect>
        )}
        {queue === 'finished' && (
          <NativeSelect aria-label={t('audits.web.page.filters.result')} value={search.result ?? ''} onChange={(e) => set('result', e.target.value)} className="w-44">
            <option value="">{t('audits.web.page.filters.allResults')}</option>
            {AUDIT_RESULTS.map((r) => (
              <option key={r} value={r}>
                {t(`audits.results.${r}`)}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="grid gap-1">
          <Label htmlFor="audits-from">{t('audits.web.page.filters.from')}</Label>
          <Input id="audits-from" type="date" className="w-44" value={search.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audits-to">{t('audits.web.page.filters.to')}</Label>
          <Input id="audits-to" type="date" className="w-44" value={search.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>
      {issue && <p className="text-destructive text-sm">{t(RANGE_ISSUE_KEYS[issue])}</p>}
      <Tabs value={queue} onValueChange={(v) => go({ ...search, queue: v as AuditQueue }, false)}>
        <TabsList>
          {AUDIT_QUEUES.map((q) => (
            <TabsTrigger key={q} value={q}>
              {t(`audits.queues.${q}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {AUDIT_QUEUES.map((q) => (
          <TabsContent key={q} value={q} className="grid gap-4 pt-2">
            {!issue && rows.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
            {!issue && rows.isError && <p className="text-destructive">{errorText(t, rows.error)}</p>}
            {!issue && rows.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t(`audits.web.page.empty.${q}`)}</p>}
            {!issue && items.length > 0 && <QueueTable queue={q} items={items} />}
            {!issue && rows.hasNextPage && (
              <Button variant="outline" className="w-fit" disabled={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>
                {t('audits.web.page.more')}
              </Button>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function QueueTable({ queue, items }: { queue: AuditQueue; items: AuditQueueRow[] }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const formatDateTime = useFormatDateTime();
  const start = useStartAudit();
  const when = (iso: string | null) => (iso ? formatDateTime(iso) : '—');

  const cell = (r: AuditQueueRow, c: Column) => {
    switch (c) {
      case 'date':
        return formatLocalDate(r.localDate, tenant.locale);
      case 'checklist':
        return r.auditId ? (
          <Link to="/audits/$auditId" params={{ auditId: r.auditId }} className="font-medium underline-offset-4 hover:underline">
            {r.checklist.name}
          </Link>
        ) : (
          r.checklist.name
        );
      case 'site':
        return r.site.name;
      case 'executor':
        return r.executor.fullName;
      case 'completedAt':
        return when(r.completedAt);
      case 'auditor':
        return actorName(t, r.auditor);
      case 'startedAt':
        return when(r.startedAt);
      case 'finishedAt':
        return when(r.finishedAt);
      case 'status':
        // An audit whose run went back to the worker is paused (spec §3.3).
        return r.status === 'correction_required' ? (
          <Badge variant="destructive">{t('scheduling.statuses.correction_required')}</Badge>
        ) : (
          <Badge variant="secondary">{t('audits.statuses.in_progress')}</Badge>
        );
      case 'result':
        return r.result ? <Badge variant={resultVariant(r.result)}>{t(`audits.results.${r.result}`)}</Badge> : '—';
      case 'score':
        return r.percent === null ? '—' : t('executions.percent', { value: formatPercent(r.percent, tenant.locale) });
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS[queue].map((c) => (
            <TableHead key={c}>{t(`audits.web.page.columns.${c}`)}</TableHead>
          ))}
          {queue === 'waiting' && <TableHead>{t('common.actions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <TableRow key={r.occurrenceId}>
            {COLUMNS[queue].map((c) => (
              <TableCell key={c} className={c === 'score' ? 'tabular-nums' : undefined}>
                {cell(r, c)}
              </TableCell>
            ))}
            {queue === 'waiting' && (
              <TableCell>
                <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(r.executionId, { onError: (e) => toast.error(errorText(t, e)) })}>
                  {t('audits.actions.start')}
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

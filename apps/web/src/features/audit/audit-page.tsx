import type { AuditEntryDto } from '@taskop/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatDateTime } from '@/lib/format';
import { api } from '@/lib/session';
import { AuditDiff } from './audit-diff';

const ENTITY_TYPES = ['user', 'role', 'site', 'site_type', 'team', 'tenant', 'session'] as const;

/** `<input type="date">` gives a local day; convert to the UTC instant at its start/end. */
const dayBoundary = (day: string, end: boolean) => (day ? new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

export function AuditPage() {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const filters = {
    action: useDeferredValue(action.trim()) || undefined,
    entityType: entityType || undefined,
    from: dayBoundary(from, false),
    to: dayBoundary(to, true),
  };
  const entries = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => api.audit.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = entries.data?.pages.flatMap((p) => p.items) ?? [];
  const actorName = (e: AuditEntryDto) =>
    e.actor.type === 'platform_admin' ? t('audit.actorPlatform') : e.actor.type === 'system' ? t('audit.actorSystem') : (e.actor.name ?? '—');

  return (
    <div>
      <PageHeader title={t('audit.title')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="f-action">{t('audit.filters.action')}</Label>
          <Input id="f-action" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-entity">{t('audit.filters.entityType')}</Label>
          <NativeSelect id="f-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {t(`audit.entityTypes.${et}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-from">{t('audit.filters.from')}</Label>
          <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">{t('audit.filters.to')}</Label>
          <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('audit.columns.time')}</TableHead>
            <TableHead>{t('audit.columns.actor')}</TableHead>
            <TableHead>{t('audit.columns.action')}</TableHead>
            <TableHead>{t('audit.columns.entity')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((e) => (
            <Fragment key={e.id}>
              <TableRow>
                <TableCell className="text-sm whitespace-nowrap">{formatDateTime(e.occurredAt)}</TableCell>
                <TableCell>{actorName(e)}</TableCell>
                <TableCell className="font-mono text-sm">{e.action}</TableCell>
                <TableCell>{t(`audit.entityTypes.${e.entityType}`, { defaultValue: e.entityType })}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    {t('audit.showChanges')}
                  </Button>
                </TableCell>
              </TableRow>
              {open === e.id && (
                <TableRow>
                  <TableCell colSpan={5} className="bg-muted/30">
                    <AuditDiff before={e.before} after={e.after} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {!entries.isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {entries.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={entries.isFetchingNextPage} onClick={() => void entries.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

import { ApiError } from '@taskop/api-client';
import type { PlatformTenantDto } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { platformApi, platformSession, usePlatformAdmin } from './platform-session';

interface TableProps {
  tenants: PlatformTenantDto[];
  onSuspend: (id: string) => Promise<void> | void;
  onReactivate: (id: string) => Promise<void> | void;
}

export function PlatformTenantsTable({ tenants, onSuspend, onReactivate }: TableProps) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('platform.tenants.name')}</TableHead>
          <TableHead>{t('platform.tenants.orgCode')}</TableHead>
          <TableHead>{t('platform.tenants.users')}</TableHead>
          <TableHead>{t('platform.tenants.created')}</TableHead>
          <TableHead>{t('platform.tenants.status')}</TableHead>
          <TableHead />
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tenants.map((tn) => (
          <TableRow key={tn.id}>
            <TableCell className="font-medium">{tn.name}</TableCell>
            <TableCell className="font-mono">{tn.orgCode}</TableCell>
            <TableCell>{tn.userCount}</TableCell>
            <TableCell>{formatDateTime(tn.createdAt, { locale: 'az', timeZone: 'Asia/Baku' })}</TableCell>
            <TableCell>
              <Badge variant={tn.status === 'active' ? 'default' : 'destructive'}>
                {t(`platform.tenants.${tn.status}`)}
              </Badge>
            </TableCell>
            <TableCell>
              <a href={`/platform/tenants/${tn.id}/checklists`} className="text-sm hover:underline">
                {t('platform.tenants.checklists')}
              </a>
            </TableCell>
            <TableCell className="text-right">
              {tn.status === 'active' ? (
                <ConfirmButton
                  variant="destructive"
                  label={t('platform.tenants.suspend')}
                  title={t('platform.tenants.suspend')}
                  description={t('platform.tenants.confirmSuspend', { name: tn.name })}
                  onConfirm={() => onSuspend(tn.id)}
                />
              ) : (
                <Button variant="outline" onClick={() => void onReactivate(tn.id)}>
                  {t('platform.tenants.reactivate')}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PlatformTenantsPage() {
  const { t } = useTranslation();
  const admin = usePlatformAdmin();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', q],
    queryFn: async () => (await platformApi.tenants.list({ q: q || undefined, limit: 200 })).items,
    enabled: admin !== null,
  });
  useEffect(() => {
    if (tenants.error instanceof ApiError && tenants.error.code === 'UNAUTHENTICATED')
      void platformSession.signOut();
  }, [tenants.error]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('platform.tenants.title')}</h1>
      <Input
        type="search"
        className="max-w-sm"
        placeholder={t('platform.tenants.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <PlatformTenantsTable
        tenants={tenants.data ?? []}
        onSuspend={(id) => act(() => platformApi.tenants.suspend(id))}
        onReactivate={(id) => act(() => platformApi.tenants.reactivate(id))}
      />
    </div>
  );
}

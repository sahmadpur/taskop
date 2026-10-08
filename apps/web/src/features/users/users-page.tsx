import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { useFormatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { CreateWorkerDialog } from './create-worker-dialog';
import { InviteStaffDialog } from './invite-staff-dialog';
import { type UserFilters, useUsersInfinite } from './queries';
import { loginLabel, statusVariant } from './user-labels';

export function UsersPage() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = useCan('users.manage');
  const canSeeRoles = useCan('roles.view');
  const formatDateTime = useFormatDateTime();
  const roles = useRoles(canSeeRoles);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserFilters['status']>(undefined);
  const [roleId, setRoleId] = useState<string | undefined>(undefined);
  const q = useDeferredValue(search.trim());
  const users = useUsersInfinite({ q: q || undefined, status, roleId });
  const [dialog, setDialog] = useState<'worker' | 'invite' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setDialog('invite')}>
                {t('users.invite')}
              </Button>
              <Button onClick={() => setDialog('worker')}>{t('users.newWorker')}</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" className="max-w-sm" placeholder={t('users.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect className="w-48" aria-label={t('users.columns.status')} value={status ?? ''} onChange={(e) => setStatus((e.target.value || undefined) as UserFilters['status'])}>
          <option value="">{t('common.all')}</option>
          {(['active', 'invited', 'deactivated'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`users.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
        {canSeeRoles && (
          <NativeSelect className="w-56" aria-label={t('users.columns.role')} value={roleId ?? ''} onChange={(e) => setRoleId(e.target.value || undefined)}>
            <option value="">{t('common.all')}</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {roleDisplayName(t, r)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('users.columns.name')}</TableHead>
            <TableHead>{t('users.columns.login')}</TableHead>
            <TableHead>{t('users.columns.role')}</TableHead>
            <TableHead>{t('users.columns.status')}</TableHead>
            <TableHead>{t('users.columns.lastLogin')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id} className="cursor-pointer" onClick={() => void navigate({ to: '/users/$userId', params: { userId: u.id } })}>
              <TableCell>
                <div className="font-medium">{u.fullName}</div>
                <div className="text-muted-foreground text-xs">{u.jobTitle ?? t(`users.kinds.${u.kind}`)}</div>
              </TableCell>
              <TableCell className="font-mono text-sm">{loginLabel(u)}</TableCell>
              <TableCell>{roleDisplayName(t, { name: u.role.name, systemKey: u.role.systemKey })}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(u.status)}>{t(`users.statuses.${u.status}`)}</Badge>
              </TableCell>
              <TableCell className="text-sm">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.never')}</TableCell>
            </TableRow>
          ))}
          {!users.isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('users.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {users.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}
      <CreateWorkerDialog open={dialog === 'worker'} onOpenChange={(o) => setDialog(o ? 'worker' : null)} orgCode={me.tenant.orgCode} onCreated={() => void refresh()} />
      <InviteStaffDialog open={dialog === 'invite'} onOpenChange={(o) => setDialog(o ? 'invite' : null)} onInvited={() => void refresh()} />
    </div>
  );
}

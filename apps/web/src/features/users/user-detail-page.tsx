import type { UserDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoles } from '@/features/roles/queries';
import { useSites } from '@/features/sites/queries';
import { useActiveUsers, useTeams } from '@/features/teams/queries';
import { useCan, useMe } from '@/lib/session';
import { useUser } from './queries';
import { UserAccessCard } from './user-access-card';
import { UserAssignments } from './user-assignments';
import { UserProfileForm } from './user-profile-form';

export function UserDetailPage() {
  const { t } = useTranslation();
  const { userId } = useParams({ from: '/app/users/$userId' });
  const me = useMe();
  const qc = useQueryClient();
  const canManage = useCan('users.manage');
  const canSeeRoles = useCan('roles.view');
  const canSeeSites = useCan('sites.view');
  const canSeeTeams = useCan('teams.view');
  const user = useUser(userId);
  const roles = useRoles(canSeeRoles);
  const sites = useSites();
  const teams = useTeams();
  const managers = useActiveUsers(true);

  if (!user.data) return <p>{user.isError ? t('errors.NOT_FOUND') : t('common.loading')}</p>;
  const u = user.data;
  const isSelf = u.id === me.user.id;
  const onChanged = (updated: UserDto) => {
    qc.setQueryData(['users', updated.id], updated);
    void qc.invalidateQueries({ queryKey: ['users', 'list'] });
  };
  const roleList = canSeeRoles && roles.data ? roles.data : [{ ...u.role, dataScope: 'own' as const, editable: false, active: true, permissions: [], userCount: 0 }];

  return (
    <div className="grid gap-6">
      <Link to="/users" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> {t('users.title')}
      </Link>
      <PageHeader title={u.fullName} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('users.detail.profile')}</CardTitle>
            </CardHeader>
            <CardContent>
              <UserProfileForm user={u} roles={roleList} managers={managers.data ?? []} isSelf={isSelf} canManage={canManage} onSaved={onChanged} />
            </CardContent>
          </Card>
          {(canSeeSites || canSeeTeams) && (
            <Card>
              <CardHeader>
                <CardTitle>{t('users.detail.assignments')}</CardTitle>
              </CardHeader>
              <CardContent>
                <UserAssignments
                  key={u.id}
                  user={u}
                  sites={canSeeSites ? (sites.data ?? []) : null}
                  teams={canSeeTeams ? (teams.data ?? []) : null}
                  canManage={canManage}
                  onSaved={onChanged}
                />
              </CardContent>
            </Card>
          )}
        </div>
        <UserAccessCard user={u} orgCode={me.tenant.orgCode} isSelf={isSelf} canManage={canManage} onChanged={onChanged} />
      </div>
    </div>
  );
}

import type { TeamDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { useActiveUsers, useTeams } from './queries';
import { TeamDialog } from './team-dialog';

export function TeamsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('teams.manage');
  const canSeeUsers = useCan('users.view');
  const teams = useTeams();
  const users = useActiveUsers(canSeeUsers);
  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['teams'] });

  return (
    <div>
      <PageHeader title={t('teams.title')} actions={canManage && <Button onClick={() => setEditing('new')}>{t('teams.add')}</Button>} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('teams.name')}</TableHead>
            <TableHead>{t('teams.members')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(teams.data ?? []).map((team) => (
            <TableRow key={team.id}>
              <TableCell>
                <div className="font-medium">{team.name}</div>
                {team.description && <div className="text-muted-foreground text-xs">{team.description}</div>}
              </TableCell>
              <TableCell>{t('teams.membersCount', { count: team.memberIds.length })}</TableCell>
              <TableCell>
                <Badge variant={team.active ? 'default' : 'secondary'}>{team.active ? t('common.active') : t('common.inactive')}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(team)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.teams.update(team.id, { active: !team.active });
                          await refresh();
                        } catch (e) {
                          toast.error(errorText(t, e));
                        }
                      }}
                    >
                      {team.active ? t('common.deactivate') : t('common.reactivate')}
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {teams.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground text-center">
                {t('teams.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && (
        <TeamDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          team={editing === 'new' ? undefined : editing}
          users={users.data ?? []}
          canEditMembers={canSeeUsers}
          onSubmit={async (v) => {
            const description = v.description || null;
            try {
              let team: TeamDto;
              if (editing === 'new') {
                team = await api.teams.create({ name: v.name, description });
                // Switch to edit mode so a retry after a partial failure updates instead of duplicating.
                setEditing(team);
              } else {
                team = await api.teams.update(editing.id, { name: v.name, description });
              }
              if (canSeeUsers) {
                const current = new Set(team.memberIds);
                const changed = v.memberIds.length !== current.size || v.memberIds.some((id) => !current.has(id));
                if (changed) await api.teams.setMembers(team.id, v.memberIds);
              }
            } finally {
              await refresh();
            }
          }}
        />
      )}
    </div>
  );
}

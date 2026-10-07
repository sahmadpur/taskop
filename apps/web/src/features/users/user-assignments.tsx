import type { SiteDto, TeamDto, UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckboxList } from '@/components/checkbox-list';
import { Button } from '@/components/ui/button';
import { indentedName } from '@/features/sites/tree';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';

interface Props {
  user: UserDto;
  sites: SiteDto[] | null;
  teams: TeamDto[] | null;
  canManage: boolean;
  onSaved: (user: UserDto) => void;
}

export function UserAssignments({ user, sites, teams, canManage, onSaved }: Props) {
  const { t } = useTranslation();
  const [siteIds, setSiteIds] = useState(user.siteIds);
  const [teamIds, setTeamIds] = useState(user.teamIds);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-4">
      {sites && (
        <CheckboxList
          label={t('users.form.sites')}
          disabled={!canManage}
          options={sites.filter((s) => s.active || siteIds.includes(s.id)).map((s) => ({ value: s.id, label: indentedName(s) }))}
          value={siteIds}
          onChange={setSiteIds}
        />
      )}
      {teams && (
        <CheckboxList
          label={t('users.form.teams')}
          disabled={!canManage}
          options={teams.filter((tm) => tm.active || teamIds.includes(tm.id)).map((tm) => ({ value: tm.id, label: tm.name }))}
          value={teamIds}
          onChange={setTeamIds}
        />
      )}
      {canManage && (
        <div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                let updated = user;
                if (sites) updated = await api.users.setSites(user.id, siteIds);
                if (teams) updated = await api.users.setTeams(user.id, teamIds);
                onSaved(updated);
                toast.success(t('common.saved'));
              } catch (e) {
                toast.error(errorText(t, e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('users.detail.saveAssignments')}
          </Button>
        </div>
      )}
    </div>
  );
}

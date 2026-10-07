import { DATA_SCOPES, type DataScope, type PermissionCatalog, type PermissionKey, type RoleDto } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/errors';
import { PermissionGrid } from './permission-grid';
import { roleDisplayName } from './queries';

export interface RoleDraft {
  name: string;
  dataScope: DataScope;
  permissions: PermissionKey[];
}

interface Props {
  role: RoleDto | null;
  catalog: PermissionCatalog;
  held: ReadonlySet<PermissionKey>;
  canManage: boolean;
  onSave: (draft: RoleDraft) => Promise<void>;
  onToggleActive?: () => Promise<void>;
}

export function RoleEditor({ role, catalog, held, canManage, onSave, onToggleActive }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RoleDraft>({ name: '', dataScope: 'own', permissions: [] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(role ? { name: role.name, dataScope: role.dataScope, permissions: role.permissions } : { name: '', dataScope: 'own', permissions: [] });
    setError(null);
  }, [role]);
  const locked = !canManage || (role !== null && !role.editable);
  const nameLocked = locked || role?.systemKey != null;

  return (
    <div className="grid gap-4">
      {role && !role.editable && <p className="text-muted-foreground text-sm">{t('roles.locked')}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="role-name">{t('roles.name')}</Label>
        <Input
          id="role-name"
          value={role?.systemKey ? roleDisplayName(t, role) : draft.name}
          disabled={nameLocked}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="role-scope">{t('roles.scope')}</Label>
        <NativeSelect id="role-scope" value={draft.dataScope} disabled={locked} onChange={(e) => setDraft({ ...draft, dataScope: e.target.value as DataScope })}>
          {DATA_SCOPES.map((s) => (
            <option key={s} value={s}>
              {t(`roles.scopes.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t('roles.permissions')}</span>
        <PermissionGrid catalog={catalog} value={draft.permissions} onChange={(permissions) => setDraft({ ...draft, permissions })} held={held} disabled={locked} />
      </div>
      <FormError message={error} />
      {!locked && (
        <div className="flex gap-2">
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave(draft);
              } catch (e) {
                setError(errorText(t, e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('common.save')}
          </Button>
          {role && !role.systemKey && onToggleActive && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await onToggleActive();
                } catch (e) {
                  setError(errorText(t, e));
                }
              }}
            >
              {role.active ? t('common.deactivate') : t('common.reactivate')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

import type { PermissionCatalog, PermissionKey } from '@taskop/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { permissionLabelKey } from './queries';

interface Props {
  catalog: PermissionCatalog;
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  held: ReadonlySet<PermissionKey>;
  disabled: boolean;
}

export function PermissionGrid({ catalog, value, onChange, held, disabled }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {catalog.map((group) => (
        <fieldset key={group.group} className="grid gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{t(`roles.groups.${group.group}`)}</legend>
          {group.keys.map((key) => {
            const checked = value.includes(key);
            const cannotGrant = !held.has(key) && !checked;
            return (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-${key}`}
                  checked={checked}
                  disabled={disabled || cannotGrant}
                  onCheckedChange={(c) => onChange(c === true ? [...value, key] : value.filter((k) => k !== key))}
                />
                <Label htmlFor={`${id}-${key}`} className="font-normal">
                  {t(permissionLabelKey(key))}
                </Label>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { type RoleDto, updateUserInputSchema, type UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { roleDisplayName } from '@/features/roles/queries';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

const emptyToNull = (v: unknown) => (v === '' ? null : v);

interface Props {
  user: UserDto;
  roles: RoleDto[];
  managers: UserDto[];
  isSelf: boolean;
  canManage: boolean;
  onSaved: (user: UserDto) => void;
}

export function UserProfileForm({ user, roles, managers, isSelf, canManage, onSaved }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof updateUserInputSchema>, unknown, z.output<typeof updateUserInputSchema>>({
    resolver: zodResolver(updateUserInputSchema),
    values: {
      fullName: user.fullName,
      jobTitle: user.jobTitle,
      phone: user.phone,
      roleId: user.role.id,
      managerId: user.managerId,
      ...(user.kind === 'worker' ? { username: user.username ?? '' } : {}),
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      onSaved(await api.users.update(user.id, values));
      toast.success(t('common.saved'));
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  const roleOptions = roles.filter((r) => r.active || r.id === user.role.id);
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="fullName" label={t('users.form.fullName')} />
        {user.kind === 'worker' && <TextField form={form} name="username" label={t('users.form.username')} />}
        <div className="grid gap-1.5">
          <Label htmlFor="p-jobTitle">{t('users.form.jobTitle')}</Label>
          <input id="p-jobTitle" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('jobTitle', { setValueAs: emptyToNull })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-phone">{t('users.form.phone')}</Label>
          <input id="p-phone" type="tel" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('phone', { setValueAs: emptyToNull })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-role">{t('users.form.role')}</Label>
          <NativeSelect id="p-role" disabled={isSelf || !canManage} {...form.register('roleId')}>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {roleDisplayName(t, r)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-manager">{t('users.form.manager')}</Label>
          <NativeSelect id="p-manager" {...form.register('managerId', { setValueAs: emptyToNull })}>
            <option value="">{t('users.form.noManager')}</option>
            {managers
              .filter((m) => m.id !== user.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
          </NativeSelect>
        </div>
      </fieldset>
      <FormError message={error} />
      {canManage && (
        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

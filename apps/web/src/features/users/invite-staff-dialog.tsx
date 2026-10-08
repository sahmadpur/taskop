import { zodResolver } from '@hookform/resolvers/zod';
import { inviteStaffInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CheckboxList } from '@/components/checkbox-list';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, useCan, useMe } from '@/lib/session';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}

export function InviteStaffDialog({ open, onOpenChange, onInvited }: Props) {
  const { t } = useTranslation();
  const me = useMe();
  const canSeeSites = useCan('sites.view');
  const roles = useRoles();
  const sites = useSites();
  const assignable = (roles.data ?? []).filter((r) => r.active && (r.systemKey !== 'owner' || me.role.systemKey === 'owner'));
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof inviteStaffInputSchema>, unknown, z.output<typeof inviteStaffInputSchema>>({
    resolver: zodResolver(inviteStaffInputSchema),
    values: {
      fullName: '',
      email: '',
      roleId: assignable.find((r) => r.systemKey === 'manager')?.id ?? assignable[0]?.id ?? '',
      siteIds: [],
      teamIds: [],
      jobTitle: null,
      phone: null,
      managerId: null,
    },
    resetOptions: { keepDirtyValues: true },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.users.invite(values);
      toast.success(t('users.inviteSent'));
      onInvited();
      form.reset();
      onOpenChange(false);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('users.inviteTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField form={form} name="fullName" label={t('users.form.fullName')} />
          <TextField form={form} name="email" label={t('users.form.email')} type="email" />
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">{t('users.form.role')}</Label>
            <NativeSelect id="invite-role" {...form.register('roleId')}>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>
                  {roleDisplayName(t, r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {canSeeSites && (
            <Controller
              control={form.control}
              name="siteIds"
              render={({ field }) => (
                <CheckboxList
                  label={t('users.form.sites')}
                  options={(sites.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: indentedName(s) }))}
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('users.invite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

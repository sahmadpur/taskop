import { zodResolver } from '@hookform/resolvers/zod';
import { createWorkerInputSchema, type UserWithSecret } from '@taskop/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
import { useActiveUsers, useTeams } from '@/features/teams/queries';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { SecretBlock } from './secret-dialog';

type In = z.input<typeof createWorkerInputSchema>;
type Out = z.output<typeof createWorkerInputSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgCode: string;
  onCreated: (result: UserWithSecret) => void;
}

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const emptyToNull = (v: unknown) => (v === '' ? null : v);

export function CreateWorkerDialog({ open, onOpenChange, orgCode, onCreated }: Props) {
  const { t } = useTranslation();
  const canSeeSites = useCan('sites.view');
  const canSeeTeams = useCan('teams.view');
  const roles = useRoles();
  const sites = useSites();
  const teams = useTeams();
  const managers = useActiveUsers(true);
  const activeRoles = (roles.data ?? []).filter((r) => r.active && r.systemKey !== 'owner');
  const defaultRole = activeRoles.find((r) => r.systemKey === 'worker') ?? activeRoles[0];
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; secret: string } | null>(null);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(createWorkerInputSchema),
    values: {
      fullName: '',
      username: '',
      roleId: defaultRole?.id ?? '',
      credentialKind: 'pin',
      siteIds: [],
      teamIds: [],
      jobTitle: null,
      phone: null,
      managerId: null,
    },
    resetOptions: { keepDirtyValues: true },
  });
  const kind = form.watch('credentialKind');

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const { secret, ...rest } = values;
      const result = await api.users.createWorker(secret === undefined ? rest : values);
      onCreated(result);
      setCreated({ username: result.user.username ?? values.username, secret: result.generatedSecret ?? values.secret ?? '' });
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });

  const close = (o: boolean) => {
    if (!o) {
      setCreated(null);
      form.reset();
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{created ? t('users.secret.title') : t('users.createWorkerTitle')}</DialogTitle>
        </DialogHeader>
        {created ? (
          <>
            <SecretBlock orgCode={orgCode} username={created.username} secret={created.secret} />
            <DialogFooter>
              <Button onClick={() => close(false)}>{t('users.secret.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField form={form} name="fullName" label={t('users.form.fullName')} />
              <TextField form={form} name="username" label={t('users.form.username')} description={t('users.form.usernameHint')} />
              <div className="grid gap-1.5">
                <Label htmlFor="jobTitle">{t('users.form.jobTitle')}</Label>
                <input id="jobTitle" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('jobTitle', { setValueAs: emptyToNull })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="phone">{t('users.form.phone')}</Label>
                <input id="phone" type="tel" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('phone', { setValueAs: emptyToNull })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="roleId">{t('users.form.role')}</Label>
                <NativeSelect id="roleId" {...form.register('roleId')}>
                  {activeRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleDisplayName(t, r)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="managerId">{t('users.form.manager')}</Label>
                <NativeSelect id="managerId" {...form.register('managerId', { setValueAs: emptyToNull })}>
                  <option value="">{t('users.form.noManager')}</option>
                  {(managers.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="credentialKind">{t('users.form.credentialKind')}</Label>
                <NativeSelect id="credentialKind" {...form.register('credentialKind')}>
                  <option value="pin">{t('users.form.pin')}</option>
                  <option value="password">{t('users.form.password')}</option>
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="secret">{t('users.form.secret')}</Label>
                <input
                  id="secret"
                  className="border-input h-9 rounded-md border px-3 text-sm"
                  inputMode={kind === 'pin' ? 'numeric' : 'text'}
                  autoComplete="off"
                  {...form.register('secret', { setValueAs: emptyToUndefined })}
                />
                {form.formState.errors.secret?.message ? (
                  <p className="text-destructive text-sm">{t(form.formState.errors.secret.message)}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">{t('users.form.secretHint')}</p>
                )}
              </div>
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
            {canSeeTeams && (
              <Controller
                control={form.control}
                name="teamIds"
                render={({ field }) => (
                  <CheckboxList
                    label={t('users.form.teams')}
                    options={(teams.data ?? []).filter((tm) => tm.active).map((tm) => ({ value: tm.id, label: tm.name }))}
                    value={field.value ?? []}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { type TenantDto, updateTenantInputSchema } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

const TIMEZONES = Intl.supportedValuesOf('timeZone');

export function OrgSettingsForm({ tenant, canEdit }: { tenant: TenantDto; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof updateTenantInputSchema>, unknown, z.output<typeof updateTenantInputSchema>>({
    resolver: zodResolver(updateTenantInputSchema),
    defaultValues: { name: tenant.name, timezone: tenant.timezone },
  });
  const save = useMutation({
    mutationFn: api.tenant.update,
    onSuccess: async (updated) => {
      qc.setQueryData(['tenant'], updated);
      session.setMe(await api.me());
      toast.success(t('common.saved'));
    },
    onError: (e) => {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid max-w-lg gap-4" noValidate>
      <fieldset disabled={!canEdit} className="grid gap-4">
        <TextField form={form} name="name" label={t('settings.org.name')} />
        <div className="grid gap-1.5">
          <Label htmlFor="orgCode">{t('settings.org.orgCode')}</Label>
          <Input id="orgCode" value={tenant.orgCode} readOnly disabled />
          <p className="text-muted-foreground text-xs">{t('settings.org.orgCodeHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timezone">{t('settings.org.timezone')}</Label>
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <NativeSelect id="timezone" {...field} value={field.value ?? ''}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="locale">{t('settings.org.locale')}</Label>
          <Input id="locale" value={t('settings.org.localeAz')} readOnly disabled />
        </div>
      </fieldset>
      <FormError message={error} />
      {canEdit && (
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      )}
    </form>
  );
}

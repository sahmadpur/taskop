import { zodResolver } from '@hookform/resolvers/zod';
import { changeCredentialInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof changeCredentialInputSchema>>({
    resolver: zodResolver(changeCredentialInputSchema),
    defaultValues: { currentSecret: '', newSecret: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.auth.changeCredential(values);
      form.reset();
      toast.success(t('settings.password.changed'));
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid max-w-lg gap-4" noValidate>
      <TextField form={form} name="currentSecret" label={t('settings.password.current')} type="password" autoComplete="current-password" />
      <TextField form={form} name="newSecret" label={t('settings.password.next')} type="password" autoComplete="new-password" />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('settings.password.submit')}
      </Button>
    </form>
  );
}

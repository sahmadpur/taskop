import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginResult, loginStaffInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

type Values = z.input<typeof loginStaffInputSchema>;

export function LoginForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values, unknown, z.output<typeof loginStaffInputSchema>>({
    resolver: zodResolver(loginStaffInputSchema),
    defaultValues: { email: '', password: '', client: 'web' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      onSuccess(await api.auth.loginStaff(values));
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <TextField form={form} name="email" label={t('auth.login.email')} type="email" autoComplete="username" />
      <TextField form={form} name="password" label={t('auth.login.password')} type="password" autoComplete="current-password" />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('auth.login.submit')}
      </Button>
    </form>
  );
}

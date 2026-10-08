import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@taskop/contracts';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

const schema = z.object({ password: passwordSchema });

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token } = useSearch({ from: '/auth/reset-password' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('auth.missingToken'));
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '' } });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setError(null);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.reset.title')}</h1>
      {done ? (
        <>
          <p>{t('auth.reset.success')}</p>
          <Button asChild>
            <Link to="/login">{t('auth.reset.login')}</Link>
          </Button>
        </>
      ) : (
        <>
          <TextField form={form} name="password" label={t('auth.reset.password')} type="password" autoComplete="new-password" />
          <FormError message={error} />
          <Button type="submit" disabled={!token || form.formState.isSubmitting}>
            {t('auth.reset.submit')}
          </Button>
        </>
      )}
    </form>
  );
}

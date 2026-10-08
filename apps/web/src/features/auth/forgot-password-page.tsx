import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordInputSchema } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordInputSchema>, unknown, z.output<typeof forgotPasswordInputSchema>>({
    resolver: zodResolver(forgotPasswordInputSchema),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (e) {
      setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.forgot.title')}</h1>
      {sent ? (
        <p>{t('auth.forgot.sent')}</p>
      ) : (
        <>
          <TextField form={form} name="email" label={t('auth.forgot.email')} type="email" autoComplete="email" />
          <FormError message={error} />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('auth.forgot.submit')}
          </Button>
        </>
      )}
      <Link to="/login" className="text-sm underline">
        {t('auth.forgot.back')}
      </Link>
    </form>
  );
}

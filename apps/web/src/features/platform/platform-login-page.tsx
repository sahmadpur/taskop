import { zodResolver } from '@hookform/resolvers/zod';
import { platformLoginInputSchema } from '@taskop/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { Logo } from '@/components/logo';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { platformApi, platformSession } from './platform-session';

export function PlatformLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof platformLoginInputSchema>, unknown, z.output<typeof platformLoginInputSchema>>({
    resolver: zodResolver(platformLoginInputSchema),
    defaultValues: { email: '', password: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await platformSession.signIn(await platformApi.login(values));
      await navigate({ to: '/platform/tenants' });
    } catch (e) {
      setError(errorText(t, e));
    }
  });
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 p-6">
      <Logo className="text-white" />
      <form onSubmit={onSubmit} className="bg-background grid w-full max-w-md gap-4 rounded-xl p-8" noValidate>
        <h1 className="text-xl font-semibold">{t('platform.login.title')}</h1>
        <TextField form={form} name="email" label={t('platform.login.email')} type="email" autoComplete="username" />
        <TextField form={form} name="password" label={t('platform.login.password')} type="password" autoComplete="current-password" />
        <FormError message={error} />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('platform.login.submit')}
        </Button>
      </form>
    </div>
  );
}

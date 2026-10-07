import { zodResolver } from '@hookform/resolvers/zod';
import { signupInputSchema } from '@taskop/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof signupInputSchema>, unknown, z.output<typeof signupInputSchema>>({
    resolver: zodResolver(signupInputSchema),
    defaultValues: { orgName: '', orgCode: '', fullName: '', email: '', password: '', client: 'web' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await session.signedIn(await api.auth.signup(values));
      await navigate({ to: '/' });
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.signup.title')}</h1>
      <TextField form={form} name="orgName" label={t('auth.signup.orgName')} autoComplete="organization" />
      <TextField form={form} name="orgCode" label={t('auth.signup.orgCode')} description={t('auth.signup.orgCodeHint')} />
      <TextField form={form} name="fullName" label={t('auth.signup.fullName')} autoComplete="name" />
      <TextField form={form} name="email" label={t('auth.signup.email')} type="email" autoComplete="email" />
      <TextField form={form} name="password" label={t('auth.signup.password')} type="password" autoComplete="new-password" description={t('auth.signup.passwordHint')} />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('auth.signup.submit')}
      </Button>
      <p className="text-muted-foreground text-sm">
        {t('auth.signup.haveAccount')}{' '}
        <Link to="/login" className="underline">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </form>
  );
}

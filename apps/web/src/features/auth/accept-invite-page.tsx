import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@taskop/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], error: 'auth.invite.mismatch' });

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useSearch({ from: '/auth/accept-invite' });
  const [error, setError] = useState<string | null>(token ? null : t('auth.missingToken'));
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setError(null);
    try {
      await session.signedIn(await api.auth.acceptInvite({ token, password, client: 'web' }));
      await navigate({ to: '/' });
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.invite.title')}</h1>
      <TextField form={form} name="password" label={t('auth.invite.password')} type="password" autoComplete="new-password" />
      <TextField form={form} name="confirm" label={t('auth.invite.confirm')} type="password" autoComplete="new-password" />
      <FormError message={error} />
      <Button type="submit" disabled={!token || form.formState.isSubmitting}>
        {t('auth.invite.submit')}
      </Button>
    </form>
  );
}

import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { token } = useSearch({ from: '/verify-email' });
  const [state, setState] = useState<'pending' | 'done' | 'error'>(token ? 'pending' : 'error');
  const [error, setError] = useState<string | null>(token ? null : t('auth.missingToken'));
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.auth
      .verifyEmail(token)
      .then(async () => {
        setState('done');
        const s = session.get();
        if (s.status === 'authenticated') session.setMe(await api.me());
      })
      .catch((e: unknown) => {
        setState('error');
        setError(errorText(t, e));
      });
  }, [token, t]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Logo />
      <div className="grid w-full max-w-md gap-4 rounded-xl border p-8">
        <h1 className="text-xl font-semibold">{t('auth.verify.title')}</h1>
        {state === 'pending' && <p>{t('auth.verify.verifying')}</p>}
        {state === 'done' && <p>{t('auth.verify.success')}</p>}
        <FormError message={error} />
        <Button asChild>
          <Link to="/">{t('auth.verify.continue')}</Link>
        </Button>
      </div>
    </div>
  );
}

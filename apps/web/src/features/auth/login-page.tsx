import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { safeRedirectPath } from '@/lib/redirect';
import { session } from '@/lib/session';
import { LoginForm } from './login-form';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const { redirect } = useSearch({ from: '/auth/login' });
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">{t('auth.login.title')}</h1>
      <LoginForm
        onSuccess={async (result) => {
          await session.signedIn(result);
          const target = safeRedirectPath(redirect);
          if (target) router.history.push(target);
          else await navigate({ to: '/' });
        }}
      />
      <div className="text-muted-foreground grid gap-2 text-sm">
        <Link to="/forgot-password" className="underline">
          {t('auth.login.forgot')}
        </Link>
        <span>
          {t('auth.login.noAccount')}{' '}
          <Link to="/signup" className="underline">
            {t('auth.login.signupLink')}
          </Link>
        </span>
        <span>{t('auth.login.workersHint')}</span>
      </div>
    </div>
  );
}

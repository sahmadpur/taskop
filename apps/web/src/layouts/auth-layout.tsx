import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageMenu } from '@/components/language-menu';
import { Logo, Mark } from '@/components/logo';

/**
 * Sign-in, sign-up and the password pages. A deep brand panel carries the mark and the one-line promise on wide
 * screens; the form sits on the canvas with the language selector in the corner.
 */
export function AuthLayout() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="bg-deep text-on-deep relative hidden flex-col justify-between overflow-hidden p-10 lg:flex" aria-hidden>
        <Logo tone="inherit" className="text-xl text-white" />
        <div className="relative grid gap-4">
          <Mark className="text-saffron size-16" />
          <p className="max-w-sm text-2xl leading-snug font-semibold tracking-[-0.02em] text-white">{t('auth.tagline')}</p>
          <p className="text-on-deep-muted max-w-sm text-sm">{t('auth.taglineBody')}</p>
        </div>
        <Mark className="absolute -right-24 -bottom-24 size-[28rem] text-white/[0.04]" />
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Logo className="lg:hidden" />
          <LanguageMenu />
        </div>
        <main id="main" className="flex flex-1 items-center justify-center p-4 pb-12">
          <div className="bg-card shadow-card w-full max-w-md rounded-xl p-6 sm:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

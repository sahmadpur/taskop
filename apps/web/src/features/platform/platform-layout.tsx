import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { platformSession, usePlatformAdmin } from './platform-session';

export function PlatformLayout() {
  const { t } = useTranslation();
  const admin = usePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-6 bg-slate-900 px-6 py-3 text-white">
        <Logo className="text-white" />
        <nav className="flex gap-4 text-sm">
          <Link to="/platform/tenants" activeProps={{ className: 'font-semibold underline' }}>
            {t('platform.nav.tenants')}
          </Link>
          <Link to="/platform/templates" activeProps={{ className: 'font-semibold underline' }}>
            {t('platform.nav.templates')}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span>{admin?.fullName}</span>
          <Button size="sm" variant="secondary" onClick={() => void platformSession.signOut()}>
            {t('platform.logout')}
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}

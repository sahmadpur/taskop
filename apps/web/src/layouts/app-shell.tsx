import type { PermissionKey } from '@taskop/contracts';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Building2, CalendarCheck, CalendarClock, CalendarDays, ChartColumn, ClipboardCheck, ClipboardList, Clock, Home, LayoutTemplate, ListChecks, LogOut, type LucideIcon, Megaphone, Settings, Shield, TriangleAlert, Users, UsersRound } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { session } from '@/lib/session';
import { UserMenu } from './user-menu';
import { VerifyEmailBanner } from './verify-email-banner';

export interface NavItem {
  to: '/' | '/users' | '/roles' | '/sites' | '/teams' | '/audit' | '/settings' | '/checklists' | '/templates' | '/assignments' | '/schedule' | '/problems' | '/tasks' | '/messages' | '/reports' | '/shifts' | '/roster';
  labelKey: string;
  icon: LucideIcon;
  /** One key, or a list of which any one suffices. */
  permission?: PermissionKey | readonly PermissionKey[];
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: Home },
  { to: '/reports', labelKey: 'nav.reports', icon: ChartColumn, permission: 'reports.view' },
  { to: '/checklists', labelKey: 'nav.checklists', icon: ListChecks, permission: 'checklists.view' },
  { to: '/templates', labelKey: 'nav.templates', icon: LayoutTemplate, permission: 'checklists.manage' },
  { to: '/assignments', labelKey: 'nav.assignments', icon: CalendarCheck, permission: 'assignments.view' },
  { to: '/schedule', labelKey: 'nav.schedule', icon: CalendarClock, permission: 'assignments.view' },
  { to: '/problems', labelKey: 'nav.problems', icon: TriangleAlert, permission: 'assignments.view' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ClipboardCheck, permission: ['tasks.view', 'tasks.manage'] },
  { to: '/messages', labelKey: 'nav.messages', icon: Megaphone, permission: 'notifications.send' },
  { to: '/shifts', labelKey: 'nav.shifts', icon: Clock, permission: 'shifts.view' },
  { to: '/roster', labelKey: 'nav.roster', icon: CalendarDays, permission: 'shifts.view' },
  { to: '/users', labelKey: 'nav.users', icon: Users, permission: 'users.view' },
  { to: '/roles', labelKey: 'nav.roles', icon: Shield, permission: 'roles.view' },
  { to: '/sites', labelKey: 'nav.sites', icon: Building2, permission: 'sites.view' },
  { to: '/teams', labelKey: 'nav.teams', icon: UsersRound, permission: 'teams.view' },
  { to: '/audit', labelKey: 'nav.audit', icon: ClipboardList, permission: 'audit.view' },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

export function AppShell() {
  const { t } = useTranslation();
  const s = useSyncExternalStore(session.subscribe, session.get);
  const navigate = useNavigate();
  const href = useRouterState({ select: (r) => r.location.href });

  // Remember the last location seen while signed in, so the redirect target is the page the user was on
  // (not /login itself, which would loop).
  const lastHref = useRef(href);
  useEffect(() => {
    if (s.status === 'authenticated') lastHref.current = href;
  }, [s.status, href]);

  useEffect(() => {
    if (s.status === 'anonymous') void navigate({ to: '/login', search: { redirect: lastHref.current } });
  }, [s.status, navigate]);

  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const allowed = (p: NavItem['permission']) => !p || (typeof p === 'string' ? [p] : p).some((k) => me.permissions.includes(k));
  const items = NAV_ITEMS.filter((i) => allowed(i.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="px-5 py-5">
          <Logo className="text-white" />
        </div>
        <nav className="grid gap-1 px-3">
          {items.map((item) => (
            <Link
              key={item.to}
              // routes for /users, /roles, ... are registered in later tasks; widen until then
              to={item.to as '/'}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-800"
              activeProps={{ className: 'bg-slate-800 font-medium' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              <item.icon className="size-4" aria-hidden />
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <span className="text-muted-foreground text-sm">{me.tenant.name}</span>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <UserMenu me={me} />
            <Button variant="ghost" size="icon" aria-label={t('nav.logout')} onClick={() => void session.signOut()}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <VerifyEmailBanner />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

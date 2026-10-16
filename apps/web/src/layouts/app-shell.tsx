import type { PermissionKey } from '@taskop/contracts';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Building2, CalendarCheck, CalendarClock, CalendarDays, ChartColumn, ClipboardCheck, ClipboardList, Clock, Home, LayoutTemplate, ListChecks, LogOut, type LucideIcon, Megaphone, Menu, Settings, Shield, ShieldCheck, TriangleAlert, Users, UsersRound, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageMenu } from '@/components/language-menu';
import { Mark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { session } from '@/lib/session';
import { cn } from '@/lib/utils';
import { UserMenu } from './user-menu';
import { VerifyEmailBanner } from './verify-email-banner';

export interface NavItem {
  to: '/' | '/users' | '/roles' | '/sites' | '/teams' | '/audit' | '/settings' | '/checklists' | '/templates' | '/assignments' | '/schedule' | '/problems' | '/tasks' | '/audits' | '/messages' | '/reports' | '/shifts' | '/roster';
  labelKey: string;
  icon: LucideIcon;
  /** One key, or a list of which any one suffices. */
  permission?: PermissionKey | readonly PermissionKey[];
  /** The sidebar group (nav.groups.*). */
  group: 'overview' | 'operations' | 'people' | 'admin';
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: Home, group: 'overview' },
  { to: '/reports', labelKey: 'nav.reports', icon: ChartColumn, permission: 'reports.view', group: 'overview' },
  { to: '/checklists', labelKey: 'nav.checklists', icon: ListChecks, permission: 'checklists.view', group: 'operations' },
  { to: '/templates', labelKey: 'nav.templates', icon: LayoutTemplate, permission: 'checklists.manage', group: 'operations' },
  { to: '/assignments', labelKey: 'nav.assignments', icon: CalendarCheck, permission: 'assignments.view', group: 'operations' },
  { to: '/schedule', labelKey: 'nav.schedule', icon: CalendarClock, permission: 'assignments.view', group: 'operations' },
  { to: '/problems', labelKey: 'nav.problems', icon: TriangleAlert, permission: 'assignments.view', group: 'operations' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ClipboardCheck, permission: ['tasks.view', 'tasks.manage'], group: 'operations' },
  { to: '/audits', labelKey: 'nav.audits', icon: ShieldCheck, permission: 'audits.perform', group: 'operations' },
  { to: '/messages', labelKey: 'nav.messages', icon: Megaphone, permission: 'notifications.send', group: 'operations' },
  { to: '/shifts', labelKey: 'nav.shifts', icon: Clock, permission: 'shifts.view', group: 'people' },
  { to: '/roster', labelKey: 'nav.roster', icon: CalendarDays, permission: 'shifts.view', group: 'people' },
  { to: '/users', labelKey: 'nav.users', icon: Users, permission: 'users.view', group: 'people' },
  { to: '/roles', labelKey: 'nav.roles', icon: Shield, permission: 'roles.view', group: 'people' },
  { to: '/sites', labelKey: 'nav.sites', icon: Building2, permission: 'sites.view', group: 'people' },
  { to: '/teams', labelKey: 'nav.teams', icon: UsersRound, permission: 'teams.view', group: 'people' },
  { to: '/audit', labelKey: 'nav.audit', icon: ClipboardList, permission: 'audit.view', group: 'admin' },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, group: 'admin' },
];

const GROUPS: NavItem['group'][] = ['overview', 'operations', 'people', 'admin'];

export function AppShell() {
  const { t } = useTranslation();
  const s = useSyncExternalStore(session.subscribe, session.get);
  const navigate = useNavigate();
  const href = useRouterState({ select: (r) => r.location.href });
  const [open, setOpen] = useState(false);

  // Remember the last location seen while signed in, so the redirect target is the page the user was on
  // (not /login itself, which would loop).
  const lastHref = useRef(href);
  useEffect(() => {
    if (s.status === 'authenticated') lastHref.current = href;
  }, [s.status, href]);

  useEffect(() => {
    if (s.status === 'anonymous') void navigate({ to: '/login', search: { redirect: lastHref.current } });
  }, [s.status, navigate]);

  // The drawer closes on navigation and on Escape.
  const [openedAt, setOpenedAt] = useState(href);
  const drawerOpen = open && openedAt === href;
  const openDrawer = () => {
    setOpenedAt(href);
    setOpen(true);
  };
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const allowed = (p: NavItem['permission']) => !p || (typeof p === 'string' ? [p] : p).some((k) => me.permissions.includes(k));
  const items = NAV_ITEMS.filter((i) => allowed(i.permission));
  const groups = GROUPS.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(([, list]) => list.length > 0);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t('common.skipToContent')}
      </a>
      {drawerOpen && <div aria-hidden className="bg-deep/50 fixed inset-0 z-30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          'bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label={t('common.menu')}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <Mark className="size-8 text-white" />
          <div className="min-w-0">
            <div className="text-base leading-tight font-semibold tracking-[-0.02em]">Taskop</div>
            <div className="text-on-deep-muted truncate text-xs">{me.tenant.name}</div>
          </div>
          <Button variant="ghost" size="icon" className="text-on-deep ml-auto hover:bg-white/10 hover:text-white lg:hidden" aria-label={t('common.closeMenu')} onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map(([group, list]) => (
            <div key={group} className="mt-3 first:mt-0">
              <div className="text-on-deep-muted px-3 pb-1 text-[11px] font-medium">{t(`nav.groups.${group}`)}</div>
              <div className="grid gap-0.5">
                {list.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to as '/'}
                    className="text-on-deep-muted relative flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-white/8 hover:text-white focus-visible:outline-saffron"
                    activeProps={{ className: 'bg-white/10 text-white font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:rounded-r before:bg-saffron' }}
                    activeOptions={{ exact: item.to === '/' }}
                  >
                    <item.icon className="size-4" aria-hidden />
                    {t(item.labelKey)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('common.menu')} aria-expanded={drawerOpen} onClick={openDrawer}>
            <Menu />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <LanguageMenu compact />
            <NotificationBell />
            <UserMenu me={me} />
            <Button variant="ghost" size="icon" aria-label={t('nav.logout')} onClick={() => void session.signOut()}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <VerifyEmailBanner />
        <main id="main" className="flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

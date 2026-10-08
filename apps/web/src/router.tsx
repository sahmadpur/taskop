import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { ChecklistDetailRoute, ChecklistDraftRoute, ChecklistsPage, ChecklistVersionRoute, TemplateEditorRoute, TemplatesPage, TenantWorkspaceLayout } from '@/features/checklists/routes';
import { AuditPage } from '@/features/audit/audit-page';
import { AcceptInvitePage } from '@/features/auth/accept-invite-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { SignupPage } from '@/features/auth/signup-page';
import { VerifyEmailPage } from '@/features/auth/verify-email-page';
import { PlatformLoginPage } from '@/features/platform/platform-login-page';
import { platformSession } from '@/features/platform/platform-session';
import { PlatformTenantsPage } from '@/features/platform/platform-tenants-page';
import { HomePage } from '@/features/home/home-page';
import { RolesPage } from '@/features/roles/roles-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { SitesPage } from '@/features/sites/sites-page';
import { TeamsPage } from '@/features/teams/teams-page';
import { UserDetailPage } from '@/features/users/user-detail-page';
import { UsersPage } from '@/features/users/users-page';
import { AppShell } from '@/layouts/app-shell';
import { AuthLayout } from '@/layouts/auth-layout';
import { session } from '@/lib/session';

const tokenSearch = (s: Record<string, unknown>): { token?: string } => (typeof s.token === 'string' ? { token: s.token } : {});

export const rootRoute = createRootRoute({ component: Outlet });

export const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
  beforeLoad: () => {
    if (session.get().status === 'authenticated') throw redirect({ to: '/' });
  },
});

export const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: ({ location }) => {
    if (session.get().status !== 'authenticated') throw redirect({ to: '/login', search: { redirect: location.href } });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  component: LoginPage,
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s.redirect === 'string' ? { redirect: s.redirect } : {}),
});
const signupRoute = createRoute({ getParentRoute: () => authLayout, path: '/signup', component: SignupPage });
const forgotRoute = createRoute({ getParentRoute: () => authLayout, path: '/forgot-password', component: ForgotPasswordPage });
const resetRoute = createRoute({ getParentRoute: () => authLayout, path: '/reset-password', component: ResetPasswordPage, validateSearch: tokenSearch });
const acceptInviteRoute = createRoute({ getParentRoute: () => authLayout, path: '/accept-invite', component: AcceptInvitePage, validateSearch: tokenSearch });
const verifyEmailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/verify-email', component: VerifyEmailPage, validateSearch: tokenSearch });

const homeRoute = createRoute({ getParentRoute: () => appLayout, path: '/', component: HomePage });
const settingsRoute = createRoute({ getParentRoute: () => appLayout, path: '/settings', component: SettingsPage });
const sitesRoute = createRoute({ getParentRoute: () => appLayout, path: '/sites', component: SitesPage });
const teamsRoute = createRoute({ getParentRoute: () => appLayout, path: '/teams', component: TeamsPage });
const usersRoute = createRoute({ getParentRoute: () => appLayout, path: '/users', component: UsersPage });
const userDetailRoute = createRoute({ getParentRoute: () => appLayout, path: '/users/$userId', component: UserDetailPage });
const rolesRoute = createRoute({ getParentRoute: () => appLayout, path: '/roles', component: RolesPage });

const auditRoute = createRoute({ getParentRoute: () => appLayout, path: '/audit', component: AuditPage });
const checklistsWs = createRoute({ getParentRoute: () => appLayout, id: 'checklists-ws', component: TenantWorkspaceLayout });
const checklistsRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists', component: ChecklistsPage });
const checklistDetailRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists/$checklistId', component: ChecklistDetailRoute });
const templatesRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/templates', component: TemplatesPage });
const templateEditorRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/templates/$source/$templateId', component: TemplateEditorRoute });
const checklistDraftRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists/$checklistId/draft', component: ChecklistDraftRoute });
const checklistVersionRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists/$checklistId/versions/$versionId', component: ChecklistVersionRoute });

const platformLoginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/platform/login', component: PlatformLoginPage });
const platformTenantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/tenants',
  component: PlatformTenantsPage,
  beforeLoad: () => {
    if (!platformSession.get()) throw redirect({ to: '/platform/login' });
  },
});

const routeTree = rootRoute.addChildren([
  authLayout.addChildren([loginRoute, signupRoute, forgotRoute, resetRoute, acceptInviteRoute]),
  verifyEmailRoute,
  platformLoginRoute,
  platformTenantsRoute,
  appLayout.addChildren([homeRoute, settingsRoute, sitesRoute, teamsRoute, rolesRoute, usersRoute, userDetailRoute, auditRoute, checklistsWs.addChildren([checklistsRoute, checklistDetailRoute, checklistDraftRoute, checklistVersionRoute, templatesRoute, templateEditorRoute])]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

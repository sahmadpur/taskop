import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AcceptInvitePage } from '@/features/auth/accept-invite-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { SignupPage } from '@/features/auth/signup-page';
import { VerifyEmailPage } from '@/features/auth/verify-email-page';
import { HomePage } from '@/features/home/home-page';
import { SettingsPage } from '@/features/settings/settings-page';
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

const routeTree = rootRoute.addChildren([
  authLayout.addChildren([loginRoute, signupRoute, forgotRoute, resetRoute, acceptInviteRoute]),
  verifyEmailRoute,
  appLayout.addChildren([homeRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

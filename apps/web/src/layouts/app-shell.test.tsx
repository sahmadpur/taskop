import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const state: { current: { status: string; me?: unknown } } = { current: { status: 'authenticated' } };
const listeners = new Set<() => void>();
const me = (permissions: string[]) => ({
  user: { id: 'u', fullName: 'Elvin Əhmədov', jobTitle: null, kind: 'staff', email: 'e@a.az', username: null, emailVerified: true, credentialKind: 'password' },
  role: { id: 'r', name: 'Manager', systemKey: 'manager', dataScope: 'site_subtree' },
  permissions,
  tenant: { id: 't', name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
});

vi.mock('@/lib/session', () => ({
  useSession: () => state.current,
  useMe: () => state.current.me,
  useCan: (...keys: string[]) => keys.every((k) => (state.current.me as { permissions: string[] }).permissions.includes(k)),
  session: { signOut: vi.fn(), subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), get: () => state.current },
  api: { auth: { resendVerification: vi.fn() } },
}));

const { AppShell } = await import('./app-shell');

function renderShell(path = '/users') {
  const root = createRootRoute();
  const shell = createRoute({ getParentRoute: () => root, id: 'app', component: AppShell });
  const page = createRoute({ getParentRoute: () => shell, path: '/users', component: () => <p>users page</p> });
  const login = createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>login page</p> });
  const router = createRouter({ routeTree: root.addChildren([shell.addChildren([page]), login]), history: createMemoryHistory({ initialEntries: [path] }) });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

describe('AppShell', () => {
  it('shows only the menu items the user may open', async () => {
    state.current = { status: 'authenticated', me: me(['users.view', 'sites.view']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'İstifadəçilər' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Obyektlər' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rollar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit jurnalı' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Parametrlər' })).toBeInTheDocument();
  });

  it('AppShell redirects to login when the session ends', async () => {
    state.current = { status: 'authenticated', me: me([]) };
    const router = renderShell();
    await screen.findByText('users page');
    await act(async () => {
      state.current = { status: 'anonymous' };
      listeners.forEach((l) => l());
    });
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ redirect: '/users' });
  });
});

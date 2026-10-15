import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';

const state: { current: { status: string; me?: unknown } } = { current: { status: 'authenticated' } };
const listeners = new Set<() => void>();
const me = (permissions: string[]) => ({
  user: { id: 'u', fullName: 'Elvin Əhmədov', jobTitle: null, kind: 'staff', email: 'e@a.az', username: null, emailVerified: true, credentialKind: 'password', emailNotifications: true },
  role: { id: 'r', name: 'Manager', systemKey: 'manager', dataScope: 'site_subtree' },
  permissions,
  tenant: { id: 't', name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
});

vi.mock('@/lib/session', () => ({
  useSession: () => state.current,
  useMe: () => state.current.me,
  useCan: (...keys: string[]) => keys.every((k) => (state.current.me as { permissions: string[] }).permissions.includes(k)),
  session: { signOut: vi.fn(), setMe: vi.fn(), subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), get: () => state.current },
  api: {
    auth: { resendVerification: vi.fn() },
    notifications: { unreadCount: vi.fn(async () => ({ count: 2 })), list: vi.fn(async () => ({ items: [], nextCursor: null })) },
    preferences: { update: vi.fn() },
  },
}));

const { AppShell } = await import('./app-shell');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

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
    expect(screen.queryByRole('link', { name: 'Problemlər' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tapşırıqlar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mesajlar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hesabatlar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auditlər' })).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Parametrlər' })).toBeInTheDocument();
  });

  it('shows the problems page to users who may view assignments', async () => {
    state.current = { status: 'authenticated', me: me(['assignments.view']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Problemlər' })).toHaveAttribute('href', '/problems');
    expect(screen.getByRole('link', { name: 'İcra cədvəli' })).toBeInTheDocument();
  });

  it('shows tasks to holders of tasks.view or tasks.manage', async () => {
    state.current = { status: 'authenticated', me: me(['tasks.manage']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Tapşırıqlar' })).toHaveAttribute('href', '/tasks');
  });

  it('shows the notification bell with the unread count in the header', async () => {
    state.current = { status: 'authenticated', me: me([]) };
    renderShell();
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 2 oxunmamış' })).toHaveTextContent('2');
  });

  it('shows Mesajlar to holders of notifications.send', async () => {
    state.current = { status: 'authenticated', me: me(['notifications.send']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Mesajlar' })).toHaveAttribute('href', '/messages');
  });

  it('shows Hesabatlar to holders of reports.view', async () => {
    state.current = { status: 'authenticated', me: me(['reports.view']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Hesabatlar' })).toHaveAttribute('href', '/reports');
  });

  it('shows Auditlər to holders of audits.perform', async () => {
    state.current = { status: 'authenticated', me: me(['audits.perform']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Auditlər' })).toHaveAttribute('href', '/audits');
  });

  it('opens the notification settings from the user menu', async () => {
    state.current = { status: 'authenticated', me: me([]) };
    renderShell();
    // Logging out stays one click away (the open modal dialog hides the page from role queries, so check first).
    expect(await screen.findByRole('button', { name: 'Çıxış' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Elvin Əhmədov/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bildiriş ayarları' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bildiriş ayarları' });
    expect(within(dialog).getByRole('switch', { name: 'E-poçt bildirişləri' })).toBeChecked();
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

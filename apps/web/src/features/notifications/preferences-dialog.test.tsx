import { ApiError } from '@taskop/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationPreferencesDialog } from './preferences-dialog';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  setMe: vi.fn(),
  api: { preferences: { update: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  session: { setMe: mocks.setMe, get: () => ({ status: 'authenticated', me: mocks.me.current }) },
}));

const me = (user: Record<string, unknown> = {}) => ({
  user: { id: 'u1', fullName: 'Elvin Əhmədov', email: 'e@a.az', emailNotifications: true, locale: null, ...user },
  tenant: { timezone: 'Asia/Baku', locale: 'az' },
});

/** Like the real session: setMe replaces what useMe returns, and the next render shows it. */
function sessionFollowsSetMe() {
  mocks.setMe.mockImplementation((next: unknown) => {
    mocks.me.current = next;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

/** Renders the dialog and returns a rerender that keeps the same query client, so a test can change the session value underneath. */
function renderDialog() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={client}>
      <NotificationPreferencesDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { ...view, rerender: () => view.rerender(ui()) };
}

describe('NotificationPreferencesDialog', () => {
  it('switches e-mail notifications off and updates the signed-in user', async () => {
    mocks.me.current = me();
    sessionFollowsSetMe();
    mocks.api.preferences.update.mockResolvedValue({ emailNotifications: false });
    const { rerender } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Bildiriş ayarları' });
    const toggle = within(dialog).getByRole('switch', { name: 'E-poçt bildirişləri' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(mocks.api.preferences.update).toHaveBeenCalledWith({ emailNotifications: false }));
    await waitFor(() =>
      expect(mocks.setMe).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'u1', emailNotifications: false }) })),
    );
    rerender();
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(screen.queryByText('Hesabınızda e-poçt ünvanı yoxdur; e-poçt bildirişləri göndərilmir.')).not.toBeInTheDocument();
  });

  it('flips back when saving fails, and says the setting has no effect without an e-mail address', async () => {
    mocks.me.current = me({ email: null });
    mocks.api.preferences.update.mockRejectedValue(ApiError.network());
    renderDialog();
    expect(screen.getByText('Hesabınızda e-poçt ünvanı yoxdur; e-poçt bildirişləri göndərilmir.')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'E-poçt bildirişləri' });
    await userEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Serverlə əlaqə qurulmadı.');
    expect(toggle).toBeChecked();
    expect(mocks.setMe).not.toHaveBeenCalled();
  });

  it('follows the session value when it changes underneath the open dialog', async () => {
    mocks.me.current = me();
    const { rerender } = renderDialog();
    const toggle = screen.getByRole('switch', { name: 'E-poçt bildirişləri' });
    expect(toggle).toBeChecked();
    mocks.me.current = me({ emailNotifications: false });
    rerender();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('shows the server answer even when it differs from the value sent', async () => {
    mocks.me.current = me();
    sessionFollowsSetMe();
    // The user asked for "off", the server says "on" (e.g. changed from the phone meanwhile).
    mocks.api.preferences.update.mockResolvedValue({ emailNotifications: true, locale: null });
    const { rerender } = renderDialog();
    const toggle = screen.getByRole('switch', { name: 'E-poçt bildirişləri' });
    await userEvent.click(toggle);
    await waitFor(() => expect(mocks.setMe).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ emailNotifications: true, locale: null }) })));
    rerender();
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('disables the switch while saving, so a second toggle cannot call update twice', async () => {
    mocks.me.current = me();
    let resolve!: (v: { emailNotifications: boolean }) => void;
    mocks.api.preferences.update.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDialog();
    const toggle = screen.getByRole('switch', { name: 'E-poçt bildirişləri' });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).not.toBeChecked(); // the pending value shows while saving
    await userEvent.click(toggle);
    expect(mocks.api.preferences.update).toHaveBeenCalledTimes(1);
    resolve({ emailNotifications: false });
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it('does not write into the session when a different user is signed in by the time the save returns', async () => {
    mocks.me.current = me();
    let resolve!: (v: { emailNotifications: boolean }) => void;
    mocks.api.preferences.update.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDialog();
    await userEvent.click(screen.getByRole('switch', { name: 'E-poçt bildirişləri' }));
    await waitFor(() => expect(mocks.api.preferences.update).toHaveBeenCalled());
    mocks.me.current = me({ id: 'u2' });
    resolve({ emailNotifications: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'E-poçt bildirişləri' })).toBeEnabled());
    expect(mocks.setMe).not.toHaveBeenCalled();
  });
});

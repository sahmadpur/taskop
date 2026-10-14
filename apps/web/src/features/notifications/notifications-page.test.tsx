import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@taskop/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { renderWithRouter } from '@/test/router';
import { messageNote, problemNote, taskNote } from './fixtures';
import { NotificationsPage } from './notifications-page';

const mocks = vi.hoisted(() => ({
  api: { notifications: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));
/** Lets a test make opening a row reject (e.g. a navigation that throws); otherwise the real hook runs. */
const open = vi.hoisted(() => ({ failure: null as Error | null }));
vi.mock('./open-notification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./open-notification')>();
  return {
    useOpenNotification: () => {
      const real = actual.useOpenNotification();
      return (...args: Parameters<typeof real>) => (open.failure ? Promise.reject(open.failure) : real(...args));
    },
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  open.failure = null;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  mocks.api.notifications.unreadCount.mockResolvedValue({ count: 2 });
  mocks.api.notifications.markRead.mockResolvedValue(undefined);
  mocks.api.notifications.markAllRead.mockResolvedValue(undefined);
});

describe('NotificationsPage', () => {
  it('lists the inbox 30 at a time with unread rows marked, and loads more with the cursor', async () => {
    mocks.api.notifications.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor ? { items: [messageNote], nextCursor: null } : { items: [taskNote, problemNote], nextCursor: 'n2' },
    );
    renderWithRouter(<NotificationsPage />, '/notifications');
    const list = await screen.findByRole('list', { name: 'Bildirişlər' });
    expect(mocks.api.notifications.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
    expect(mocks.api.notifications.list.mock.calls[0]![0]).not.toHaveProperty('unread');
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Yeni tapşırıq');
    expect(first).toHaveTextContent('Soyuducunun qapısını təmir edin');
    expect(first).toHaveTextContent('Oxunmamış');
    expect(second).toHaveTextContent('Kritik problem');
    await userEvent.click(screen.getByRole('button', { name: 'Daha çox göstər' }));
    expect(await within(list).findByText('Sabah iclas var')).toBeInTheDocument();
    expect(mocks.api.notifications.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'n2', limit: 30 }));
    expect(within(list).getAllByRole('listitem')[2]).not.toHaveTextContent('Oxunmamış');
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
  });

  it('shows unread ones only when asked', async () => {
    mocks.api.notifications.list.mockImplementation(async (q: { unread?: string }) =>
      q.unread ? { items: [], nextCursor: null } : { items: [messageNote], nextCursor: null },
    );
    renderWithRouter(<NotificationsPage />, '/notifications');
    await screen.findByText('Sabah iclas var');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Yalnız oxunmamışlar' }));
    expect(await screen.findByText('Oxunmamış bildiriş yoxdur')).toBeInTheDocument();
    expect(mocks.api.notifications.list).toHaveBeenLastCalledWith(expect.objectContaining({ unread: 'true', limit: 30 }));
  });

  it('marks a row read and opens its target: a problem on the execution tab; a message without a page stays here', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote, { ...messageNote, readAt: null }], nextCursor: null });
    const router = renderWithRouter(<NotificationsPage />, '/notifications');
    await userEvent.click(await screen.findByRole('button', { name: /Sabah iclas var/ }));
    await waitFor(() => expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n3'));
    expect(router.state.location.pathname).toBe('/notifications');
    await userEvent.click(screen.getByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n2');
    // The count and the lists are asked again after each mark.
    await waitFor(() => expect(mocks.api.notifications.unreadCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('navigates at once while the read mark is still in flight (W9), and refetches when it settles', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote], nextCursor: null });
    let settle!: () => void;
    mocks.api.notifications.markRead.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    const router = renderWithRouter(<NotificationsPage />, '/notifications');
    await userEvent.click(await screen.findByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n2');
    const countCalls = mocks.api.notifications.unreadCount.mock.calls.length;
    settle();
    await waitFor(() => expect(mocks.api.notifications.unreadCount.mock.calls.length).toBeGreaterThan(countCalls));
  });

  it('still navigates when the read mark fails, e.g. 404 after the 90-day cleanup', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote], nextCursor: null });
    mocks.api.notifications.markRead.mockRejectedValue(new Error('not found'));
    const router = renderWithRouter(<NotificationsPage />, '/notifications');
    await userEvent.click(await screen.findByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
  });

  it('marks everything read', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [taskNote], nextCursor: null });
    renderWithRouter(<NotificationsPage />, '/notifications');
    await screen.findByText('Yeni tapşırıq');
    const markAll = screen.getByRole('button', { name: 'Hamısını oxunmuş et' });
    await waitFor(() => expect(markAll).toBeEnabled());
    await userEvent.click(markAll);
    await waitFor(() => expect(mocks.api.notifications.markAllRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.api.notifications.list).toHaveBeenCalledTimes(2));
  });

  it('shows why marking everything read failed', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [taskNote], nextCursor: null });
    mocks.api.notifications.markAllRead.mockRejectedValue(new ApiError(0, 'NETWORK', 'errors.NETWORK'));
    renderWithRouter(
      <>
        <NotificationsPage />
        <Toaster />
      </>,
      '/notifications',
    );
    const markAll = await screen.findByRole('button', { name: 'Hamısını oxunmuş et' });
    await waitFor(() => expect(markAll).toBeEnabled());
    await userEvent.click(markAll);
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeInTheDocument();
    await waitFor(() => expect(markAll).toBeEnabled());
  });

  it('logs a row whose opening fails instead of leaving the rejection unhandled', async () => {
    const failure = new Error('navigation failed');
    open.failure = failure;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote], nextCursor: null });
    renderWithRouter(<NotificationsPage />, '/notifications');
    await userEvent.click(await screen.findByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Opening the notification failed', failure));
  });
});

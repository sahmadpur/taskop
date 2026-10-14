import { ApiError } from '@taskop/api-client';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { renderWithRouter } from '@/test/router';
import { messageNote, problemNote, taskNote } from './fixtures';
import { NotificationBell } from './notification-bell';
import { notificationKeys } from './queries';

const mocks = vi.hoisted(() => ({
  api: { notifications: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

/** Opens the popover once the count (3 by default) has arrived, so its "Hamısını oxunmuş et" is enabled. */
const openBell = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Bildirişlər: 3 oxunmamış' }));
  return screen.findByRole('dialog', { name: 'Bildirişlər' });
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.resetAllMocks();
  mocks.api.notifications.unreadCount.mockResolvedValue({ count: 3 });
  mocks.api.notifications.list.mockResolvedValue({ items: [taskNote, problemNote, messageNote], nextCursor: null });
  mocks.api.notifications.markRead.mockResolvedValue(undefined);
  mocks.api.notifications.markAllRead.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('NotificationBell', () => {
  it('shows the unread count and asks again every 30 s and when the window gets focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.api.notifications.unreadCount.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 4 }).mockResolvedValue({ count: 5 });
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 3 oxunmamış' })).toHaveTextContent('3');
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 4 oxunmamış' })).toHaveTextContent('4');
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 5 oxunmamış' })).toBeInTheDocument();
    // Closed, the popover asks for nothing.
    expect(mocks.api.notifications.list).not.toHaveBeenCalled();
  });

  it('counts above 99 as 99+ and shows no badge at zero', async () => {
    mocks.api.notifications.unreadCount.mockResolvedValue({ count: 120 });
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 120 oxunmamış' })).toHaveTextContent('99+');
    cleanup();
    mocks.api.notifications.unreadCount.mockResolvedValue({ count: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderWithRouter(<NotificationBell />, '/', client);
    await waitFor(() => expect(client.getQueryData(notificationKeys.unreadCount)).toEqual({ count: 0 }));
    expect(screen.getByRole('button', { name: 'Bildirişlər' }).textContent).toBe('');
  });

  it('lists the 10 latest; a task row marks itself read, closes the popover and opens the task', async () => {
    const router = renderWithRouter(<NotificationBell />);
    const popover = await openBell();
    const rows = await within(popover).findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(mocks.api.notifications.list).toHaveBeenCalledWith({ limit: 10 });
    expect(rows[0]).toHaveTextContent('Oxunmamış');
    expect(rows[2]).not.toHaveTextContent('Oxunmamış');
    await userEvent.click(within(rows[0]!).getByRole('button'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(router.state.location.search).toEqual({ task: 't1' });
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Navigating remounts the bell and the stale count is asked again.
    await waitFor(() => expect(mocks.api.notifications.unreadCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('opens a problem on the execution tab and a message without a page in the inbox, without marking read rows again', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote, messageNote], nextCursor: null });
    const router = renderWithRouter(<NotificationBell />);
    await userEvent.click(await within(await openBell()).findByRole('button', { name: /Sabah iclas var/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    expect(mocks.api.notifications.markRead).not.toHaveBeenCalled();
    await userEvent.click(await within(await openBell()).findByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n2');
  });

  it('a row whose mark-read fails still opens its target', async () => {
    mocks.api.notifications.markRead.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    const router = renderWithRouter(<NotificationBell />);
    await userEvent.click(await within(await openBell()).findByRole('button', { name: /Yeni tapşırıq/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 't1' }));
    expect(router.state.location.pathname).toBe('/tasks');
    // The badge is asked again even though the mark failed.
    await waitFor(() => expect(mocks.api.notifications.unreadCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('marks all read and links to the full inbox', async () => {
    const router = renderWithRouter(<NotificationBell />);
    const popover = await openBell();
    mocks.api.notifications.unreadCount.mockResolvedValue({ count: 0 });
    await userEvent.click(within(popover).getByRole('button', { name: 'Hamısını oxunmuş et' }));
    await waitFor(() => expect(mocks.api.notifications.markAllRead).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Bildirişlər' })).toBeInTheDocument();
    const all = within(popover).getByRole('link', { name: 'Hamısına bax' });
    expect(all).toHaveAttribute('href', '/notifications');
    await userEvent.click(all);
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows why marking all read failed, and asks for the count again', async () => {
    mocks.api.notifications.markAllRead.mockRejectedValue(new ApiError(0, 'NETWORK', 'errors.NETWORK'));
    renderWithRouter(
      <>
        <NotificationBell />
        <Toaster />
      </>,
    );
    const popover = await openBell();
    const calls = mocks.api.notifications.unreadCount.mock.calls.length;
    await userEvent.click(within(popover).getByRole('button', { name: 'Hamısını oxunmuş et' }));
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.notifications.unreadCount.mock.calls.length).toBeGreaterThan(calls));
    expect(within(popover).getByRole('button', { name: 'Hamısını oxunmuş et' })).toBeEnabled();
  });
});

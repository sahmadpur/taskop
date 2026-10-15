import { ApiError } from '@taskop/api-client';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { formatDateTime } from '@taskop/i18n';
import { StyleSheet } from 'react-native';
import '@/lib/i18n';
import { ME, NOTIFICATION, NOTIFICATION2, NOTIFICATION3, notificationItem, OCC, OCC3, syncResponse, syncTask, T, TASK, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { readUnreadNotifications } from '@/offline/unread';
import { InboxScreen } from './inbox-screen';

const mockPush = jest.fn();
const mockFocus = { set: (_focused: boolean) => undefined as void };
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  // The screen is focused while rendered in a test, until mockFocus.set(false) blurs it.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const react = jest.requireActual<typeof import('react')>('react');
    const [focused, setFocused] = react.useState(true);
    mockFocus.set = setFocused;
    react.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));
const mockMe = { current: { permissions: [] as string[], role: { dataScope: 'own' } } };
const mockList = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();
const mockUnreadCount = jest.fn();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe.current }),
  api: {
    notifications: {
      list: (...a: unknown[]) => mockList(...a),
      markRead: (...a: unknown[]) => mockMarkRead(...a),
      markAllRead: (...a: unknown[]) => mockMarkAllRead(...a),
      unreadCount: (...a: unknown[]) => mockUnreadCount(...a),
    },
  },
}));

const A = notificationItem({ id: NOTIFICATION, title: 'Açılış yoxlaması açıldı', targetKind: 'occurrence', targetId: OCC });
const B = notificationItem({ id: NOTIFICATION2, type: 'task.assigned', title: 'Yeni tapşırıq', targetKind: 'task', targetId: TASK, targetDate: null, readAt: T.open });
const C = notificationItem({ id: NOTIFICATION3, type: 'manual', title: 'Admin mesajı', body: 'Sabah iclas var.', targetKind: 'none', targetId: null, targetDate: null });
const CURSOR = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea9';

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

const rowIds = () => screen.queryAllByTestId(/^notification-0/).map((e) => e.props.testID as string);

/** Online; OCC started on this phone; TASK mine; the server answers pulls with the same. */
async function world(o: { online?: boolean } = {}) {
  const t = await createTestServices({ online: o.online ?? true });
  const res = syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask()] });
  await t.seed(res);
  t.api.sync = res;
  await t.services.store.start(OCC, ME);
  await t.services.engine.idle();
  return t;
}

beforeEach(() => {
  mockPush.mockReset();
  mockMe.current = { permissions: [], role: { dataScope: 'own' } };
  mockFocus.set = () => undefined;
  mockList.mockReset();
  mockList.mockResolvedValue({ items: [A, B], nextCursor: null });
  mockMarkRead.mockReset();
  mockMarkRead.mockResolvedValue(undefined);
  mockMarkAllRead.mockReset();
  mockMarkAllRead.mockResolvedValue(undefined);
  mockUnreadCount.mockReset();
  mockUnreadCount.mockResolvedValue({ count: 0 });
});

describe('Bildirişlər inbox', () => {
  it('offline it says a connection is needed and asks nothing', async () => {
    const t = await world({ online: false });
    await renderWithServices(t.services, <InboxScreen />);
    expect(await screen.findByText('Bildirişlərə baxmaq üçün internet bağlantısı tələb olunur.')).toBeTruthy();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('lists the newest 30 with unread rows bold, loads the next page at the end, and stops at the last page', async () => {
    mockList.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? { items: [C], nextCursor: null } : { items: [A, B], nextCursor: CURSOR }));
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    expect(await screen.findByRole('button', { name: /^Oxunmamış: Açılış yoxlaması açıldı\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Yeni tapşırıq\./ })).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('Açılış yoxlaması açıldı').props.style).fontWeight).toBe('700');
    expect(StyleSheet.flatten(screen.getByText('Yeni tapşırıq').props.style).fontWeight).toBe('500');
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(await screen.findByText('Admin mesajı')).toBeTruthy();
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(mockList.mock.calls).toEqual([[{ limit: 30 }], [{ cursor: CURSOR, limit: 30 }]]);
    expect(rowIds()).toEqual([`notification-${A.id}`, `notification-${B.id}`, `notification-${C.id}`]);
  });

  it('drops a next page that was loading when the list was refreshed, and asks for a page once', async () => {
    const next = gate();
    let first = [A, B];
    mockList.mockImplementation(async (q: { cursor?: string }) => {
      if (q.cursor) {
        await next.opened;
        return { items: [B, C], nextCursor: null };
      }
      return { items: first, nextCursor: CURSOR };
    });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await screen.findByText('Açılış yoxlaması açıldı');
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(mockList.mock.calls.filter(([q]) => (q as { cursor?: string }).cursor)).toHaveLength(1);
    first = [C, A, B];
    mockUnreadCount.mockResolvedValue({ count: 2 });
    await fireEvent(screen.getByTestId('notification-list'), 'refresh');
    await eventually(async () => expect(rowIds()).toEqual([`notification-${C.id}`, `notification-${A.id}`, `notification-${B.id}`]));
    next.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rowIds()).toEqual([`notification-${C.id}`, `notification-${A.id}`, `notification-${B.id}`]);
    expect(await readUnreadNotifications(t.db)).toBe(2);
  });

  it('a next page asked for while the list is being refreshed is not requested, and the rows end up as the fresh page', async () => {
    const refresh = gate();
    let fresh = false;
    mockList.mockImplementation(async (q: { cursor?: string }) => {
      if (q.cursor) return { items: [C], nextCursor: null }; // the old cursor's page: must never be asked for
      if (fresh) {
        await refresh.opened;
        return { items: [C, A, B], nextCursor: null };
      }
      return { items: [A, B], nextCursor: CURSOR };
    });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await screen.findByText('Açılış yoxlaması açıldı');
    fresh = true;
    await fireEvent(screen.getByTestId('notification-list'), 'refresh');
    await eventually(async () => expect(mockList).toHaveBeenCalledTimes(2));
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(mockList.mock.calls.filter(([q]) => (q as { cursor?: string }).cursor)).toHaveLength(0);
    await act(async () => refresh.open());
    await eventually(async () => expect(rowIds()).toEqual([`notification-${C.id}`, `notification-${A.id}`, `notification-${B.id}`]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rowIds()).toEqual([`notification-${C.id}`, `notification-${A.id}`, `notification-${B.id}`]);
    expect(mockList.mock.calls.filter(([q]) => (q as { cursor?: string }).cursor)).toHaveLength(0);
  });

  it('does not navigate when the screen lost focus while the tap waited for the sync', async () => {
    const sync = gate();
    const t = await world();
    jest.spyOn(t.services, 'syncNow').mockImplementation(async () => sync.opened);
    await renderWithServices(t.services, <InboxScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Yeni tapşırıq/ }));
    await act(async () => mockFocus.set(false));
    await act(async () => sync.open());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reads each row out with its state, title, text and time', async () => {
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    const when = formatDateTime(A.createdAt, { locale: 'az', timeZone: t.services.timeZone });
    expect(await screen.findByRole('button', { name: `Oxunmamış: ${A.title}. ${A.body}. ${when}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${B.title}. ${B.body}. ${formatDateTime(B.createdAt, { locale: 'az', timeZone: t.services.timeZone })}` })).toBeTruthy();
  });

  it('a tap marks the row read, re-reads the count from the server and opens the started checklist', async () => {
    mockUnreadCount.mockResolvedValue({ count: 1 });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await screen.findByRole('button', { name: /^Oxunmamış: Açılış yoxlaması açıldı\./ });
    // The screen stored the server's 1 when it opened; the count only drops to 0 because it is read again after the mark.
    await eventually(async () => expect(await readUnreadNotifications(t.db)).toBe(1));
    mockUnreadCount.mockResolvedValue({ count: 0 });
    await fireEvent.press(await screen.findByRole('button', { name: /^Oxunmamış: Açılış yoxlaması açıldı\./ }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } }));
    expect(mockMarkRead).toHaveBeenCalledWith(A.id);
    expect(screen.getByRole('button', { name: /^Açılış yoxlaması açıldı\./ })).toBeTruthy();
    await eventually(async () => expect(await readUnreadNotifications(t.db)).toBe(0));
    expect(mockUnreadCount.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('opens a task row, and keeps a message without a target in the inbox', async () => {
    mockList.mockResolvedValue({ items: [B, C], nextCursor: null });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Yeni tapşırıq\./ }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK } }));
    expect(mockMarkRead).not.toHaveBeenCalled(); // already read
    await fireEvent.press(screen.getByRole('button', { name: /^Oxunmamış: Admin mesajı\./ }));
    await eventually(async () => expect(mockMarkRead).toHaveBeenCalledWith(C.id));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('opens a resubmitted run on the Team tab for a viewer who has it and does not hold it', async () => {
    mockMe.current = { permissions: ['reports.view'], role: { dataScope: 'tenant' } };
    const R = notificationItem({ id: NOTIFICATION3, type: 'run.resubmitted', title: 'Yoxlama yenidən təqdim edildi', targetKind: 'occurrence', targetId: OCC3, targetDate: '2026-11-02' });
    mockList.mockResolvedValue({ items: [R], nextCursor: null });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Oxunmamış: Yoxlama yenidən təqdim edildi\./ }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/team/run/[id]', params: { id: OCC3 } }));
    expect(mockMarkRead).toHaveBeenCalledWith(R.id);
  });

  it('Hamısını oxunmuş et marks every row read and re-reads the count from the server', async () => {
    mockUnreadCount.mockResolvedValue({ count: 1 });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    const markAll = await screen.findByRole('button', { name: 'Hamısını oxunmuş et' });
    await eventually(async () => expect(await readUnreadNotifications(t.db)).toBe(1));
    mockUnreadCount.mockResolvedValue({ count: 0 });
    await fireEvent.press(markAll);
    await eventually(async () => expect(screen.getByRole('button', { name: /^Açılış yoxlaması açıldı\./ })).toBeTruthy());
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Hamısını oxunmuş et' }).props.accessibilityState.disabled).toBe(true);
    await eventually(async () => expect(await readUnreadNotifications(t.db)).toBe(0));
  });

  it('says when there is nothing, and offers a retry when the list cannot be loaded', async () => {
    mockList.mockRejectedValueOnce(ApiError.network()).mockResolvedValueOnce({ items: [], nextCursor: null });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('Bildiriş yoxdur')).toBeTruthy();
  });
});

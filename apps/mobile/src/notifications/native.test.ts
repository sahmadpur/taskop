import { Platform } from 'react-native';
import { ME, OTHER, pushData } from '@/offline/testing/fixtures';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[abc]' })),
  setBadgeCountAsync: jest.fn(async () => true),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'f1c3d2a4-5b6c-4d7e-8f90-1a2b3c4d5e6f' } } }, easConfig: null },
}));
jest.mock('@/lib/secure-storage', () => {
  const store = new Map<string, string>();
  return {
    STORAGE_KEYS: { pushToken: 'taskop.pushToken' },
    secureStorage: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => void store.set(k, v),
      remove: async (k: string) => void store.delete(k),
    },
  };
});

import { configureNotifications, nativePush, notificationEvents, pushTokenStore, readProjectId, setAppBadge } from './native';

type Mocked = {
  [K in
    | 'setNotificationHandler'
    | 'setNotificationChannelAsync'
    | 'getPermissionsAsync'
    | 'requestPermissionsAsync'
    | 'getExpoPushTokenAsync'
    | 'setBadgeCountAsync'
    | 'getLastNotificationResponse'
    | 'clearLastNotificationResponse'
    | 'addNotificationResponseReceivedListener'
    | 'addNotificationReceivedListener']: jest.Mock;
};
const N = jest.requireMock<Mocked>('expo-notifications');

const note = (data: unknown, identifier = 'n1') => ({ date: 0, request: { identifier, content: { data }, trigger: null } });
type Handler = { handleNotification(n: unknown): Promise<Record<string, boolean>> };

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('native push port', () => {
  it("shows foreground notifications for the signed-in user only and creates Android's 'default' channel at startup", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    let current: string | null = ME;
    configureNotifications(() => current);
    const handler = N.setNotificationHandler.mock.calls[0]![0] as Handler;
    expect((await handler.handleNotification(note(pushData()))).shouldShowBanner).toBe(true);
    expect((await handler.handleNotification(note(pushData({ userId: OTHER })))).shouldShowBanner).toBe(false);
    current = null;
    expect((await handler.handleNotification(note(pushData()))).shouldShowList).toBe(false);
    expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('default', { name: 'Taskop bildirişləri', importance: 6, sound: 'default' });
  });

  it('clears the app badge whenever the session becomes anonymous, including a session that expired', () => {
    let current: string | null = ME;
    const listeners = new Set<() => void>();
    const change = (next: string | null) => {
      current = next;
      listeners.forEach((l) => l());
    };
    configureNotifications(() => current, (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    });
    N.setBadgeCountAsync.mockClear();
    change(ME); // e.g. a token refresh: still signed in
    expect(N.setBadgeCountAsync).not.toHaveBeenCalled();
    change(null);
    expect(N.setBadgeCountAsync).toHaveBeenCalledTimes(1);
    expect(N.setBadgeCountAsync).toHaveBeenCalledWith(0);
    change(null); // already cleared
    expect(N.setBadgeCountAsync).toHaveBeenCalledTimes(1);
    change(OTHER);
    change(null);
    expect(N.setBadgeCountAsync).toHaveBeenCalledTimes(2);
  });

  it('creates no channel on iOS', async () => {
    await nativePush.ensureChannel();
    expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(nativePush.platform()).toBe('ios');
  });

  it("maps the OS permission, asks for it, and gets the Expo token with the project's id", async () => {
    N.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false, expires: 'never' });
    expect(await nativePush.permission()).toBe('denied');
    N.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' });
    expect(await nativePush.permission()).toBe('undetermined');
    N.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' });
    expect(await nativePush.requestPermission()).toBe('granted');
    expect(nativePush.projectId()).toBe('f1c3d2a4-5b6c-4d7e-8f90-1a2b3c4d5e6f');
    expect(await nativePush.expoToken('f1c3d2a4-5b6c-4d7e-8f90-1a2b3c4d5e6f')).toBe('ExponentPushToken[abc]');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'f1c3d2a4-5b6c-4d7e-8f90-1a2b3c4d5e6f' });
    expect(nativePush.isDevice).toBe(true);
  });

  it('reads the EAS project id from extra.eas or the EAS config, and nothing from a blank one', () => {
    expect(readProjectId({ expoConfig: { extra: { eas: { projectId: 'p-1' } } }, easConfig: null })).toBe('p-1');
    expect(readProjectId({ expoConfig: { extra: {} }, easConfig: { projectId: 'p-2' } })).toBe('p-2');
    expect(readProjectId({ expoConfig: { extra: { eas: { projectId: ' ' } } }, easConfig: null })).toBeNull();
    expect(readProjectId({ expoConfig: null, easConfig: null })).toBeNull();
  });

  it('hands taps, the launch tap and receipts over as their data, and unsubscribes', () => {
    expect(notificationEvents.lastResponse()).toBeNull();
    N.getLastNotificationResponse.mockReturnValueOnce({ actionIdentifier: 'default', notification: note(pushData(), 'launch') });
    expect(notificationEvents.lastResponse()).toEqual({ identifier: 'launch', data: pushData() });
    notificationEvents.clearLastResponse();
    expect(N.clearLastNotificationResponse).toHaveBeenCalledTimes(1);

    const remove = jest.fn();
    N.addNotificationResponseReceivedListener.mockReturnValueOnce({ remove });
    const taps: unknown[] = [];
    const off = notificationEvents.onResponse((r) => taps.push(r));
    (N.addNotificationResponseReceivedListener.mock.calls[0]![0] as (r: unknown) => void)({ actionIdentifier: 'default', notification: note(pushData(), 'n2') });
    expect(taps).toEqual([{ identifier: 'n2', data: pushData() }]);
    off();
    expect(remove).toHaveBeenCalledTimes(1);

    const received: unknown[] = [];
    notificationEvents.onReceived((d) => received.push(d));
    (N.addNotificationReceivedListener.mock.calls[0]![0] as (n: unknown) => void)(note(pushData()));
    expect(received).toEqual([pushData()]);
  });

  it('keeps the push token in secure storage and sets the badge, logging a badge failure', async () => {
    expect(await pushTokenStore.get()).toBeNull();
    await pushTokenStore.set('ExponentPushToken[abc]');
    expect(await pushTokenStore.get()).toBe('ExponentPushToken[abc]');
    await pushTokenStore.clear();
    expect(await pushTokenStore.get()).toBeNull();

    setAppBadge(3);
    expect(N.setBadgeCountAsync).toHaveBeenCalledWith(3);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    N.setBadgeCountAsync.mockRejectedValueOnce(new Error('no badge'));
    setAppBadge(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledWith('[push] Could not set the app badge', 'no badge');
  });
});

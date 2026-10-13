import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import i18n from '@/lib/i18n';
import { secureStorage, STORAGE_KEYS } from '@/lib/secure-storage';
import { type NotificationEvents, PUSH_CHANNEL_ID, type PushPermission, type PushPort, type PushTokenStore, type TapResponse } from './ports';
import { foregroundBehavior } from './push-data';

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** Expo's documented lookup: the EAS project id `eas init` gives the app (app.json → expo.extra.eas.projectId). */
export function readProjectId(c: { expoConfig?: { extra?: { [key: string]: unknown } } | null; easConfig?: { projectId?: string } | null }): string | null {
  const eas = c.expoConfig?.extra?.eas as { projectId?: unknown } | undefined;
  const id = eas?.projectId ?? c.easConfig?.projectId;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

export function toPermission(s: { granted: boolean; status: string }): PushPermission {
  if (s.granted) return 'granted';
  return s.status === 'denied' ? 'denied' : 'undetermined';
}

export const nativePush: PushPort = {
  isDevice: Device.isDevice,
  platform: () => (Platform.OS === 'ios' ? 'ios' : 'android'),
  projectId: () => readProjectId(Constants),
  async ensureChannel() {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: i18n.t('mobile.notifications.channel'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  },
  permission: async () => toPermission(await Notifications.getPermissionsAsync()),
  requestPermission: async () => toPermission(await Notifications.requestPermissionsAsync()),
  expoToken: async (projectId) => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
  async setBadge(count) {
    await Notifications.setBadgeCountAsync(count);
  },
};

export const pushTokenStore: PushTokenStore = {
  get: () => secureStorage.get(STORAGE_KEYS.pushToken),
  set: (token) => secureStorage.set(STORAGE_KEYS.pushToken, token),
  clear: () => secureStorage.remove(STORAGE_KEYS.pushToken),
};

const toTap = (r: Notifications.NotificationResponse): TapResponse => ({
  identifier: r.notification.request.identifier,
  data: r.notification.request.content.data,
});

/** Decision 9: the synchronous launch-response calls; their …Async twins are deprecated in expo-notifications 57. */
export const notificationEvents: NotificationEvents = {
  lastResponse() {
    const r = Notifications.getLastNotificationResponse();
    return r ? toTap(r) : null;
  },
  clearLastResponse: () => Notifications.clearLastNotificationResponse(),
  onResponse(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener((r) => listener(toTap(r)));
    return () => subscription.remove();
  },
  onReceived(listener) {
    const subscription = Notifications.addNotificationReceivedListener((n) => listener(n.request.content.data));
    return () => subscription.remove();
  },
};

/** Spec §7.1, called once when the app starts: the foreground handler and Android's 'default' channel. */
export function configureNotifications(currentUserId: () => string | null): void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => foregroundBehavior(n.request.content.data, currentUserId()),
  });
  nativePush.ensureChannel().catch((e: unknown) => console.warn('[push] Could not create the notification channel', message(e)));
}

/** The app-icon badge (spec §7.3); best effort, since Android launchers may not support badges. */
export function setAppBadge(count: number): void {
  nativePush.setBadge(count).catch((e: unknown) => console.warn('[push] Could not set the app badge', message(e)));
}

/** Profile's "Ayarları aç" when push is denied (spec §7.4). */
export async function openSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.warn('[push] Could not open the settings', message(e));
  }
}

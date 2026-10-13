import { useEffect } from 'react';
import { api } from '@/lib/session';
import { useOffline } from '@/offline/context';
import { rnAppState } from '@/offline/native/ports';
import { nativePush, pushTokenStore } from './native';
import { startPushRegistration } from './push-registration';

/**
 * Spec §7.2: mounted inside OfflineProvider, so it runs after login and at every start while signed in, once the user's
 * local store is ready. It renders nothing and never blocks the app.
 */
export function NotificationsBridge() {
  const services = useOffline();
  useEffect(() => startPushRegistration({ push: nativePush, tokens: pushTokenStore, api, appState: rnAppState() }), [services.userId]);
  return null;
}

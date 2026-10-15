import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { canSeeTeam } from '@/features/team/team-rules';
import { api, useSession } from '@/lib/session';
import { useOffline } from '@/offline/context';
import { rnAppState } from '@/offline/native/ports';
import { nativePush, notificationEvents, pushTokenStore } from './native';
import { createRouteContext, startTapRouting } from './notification-router';
import { startPushRegistration } from './push-registration';

/**
 * Spec §7.2–7.3, mounted inside OfflineProvider: it runs after login and at every start while signed in, once the user's
 * local store is ready (so a cold-start tap can look the occurrence up). Registration, taps and foreground receipts.
 */
export function NotificationsBridge() {
  const services = useOffline();
  const s = useSession();
  const canManageTasks = useRef(false);
  canManageTasks.current = s.status === 'authenticated' && s.me.permissions.includes('tasks.manage');
  const seesTeam = useRef(false);
  seesTeam.current = s.status === 'authenticated' && canSeeTeam(s.me);
  useEffect(() => startPushRegistration({ push: nativePush, tokens: pushTokenStore, api, appState: rnAppState(), userId: services.userId }), [services.userId]);
  useEffect(
    () =>
      startTapRouting({
        events: notificationEvents,
        ctx: createRouteContext(services, () => canManageTasks.current, () => seesTeam.current),
        navigate: (route) => router.push(route),
      }),
    [services],
  );
  return null;
}

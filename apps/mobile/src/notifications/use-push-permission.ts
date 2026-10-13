import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { PushPermission, PushPort } from './ports';

export type PushPermissionState = PushPermission | 'unavailable';

/** The OS notification permission, read again whenever the app returns to the foreground (e.g. from the Settings app). */
export function usePushPermission(push: Pick<PushPort, 'isDevice' | 'permission'>): PushPermissionState | null {
  const [state, setState] = useState<PushPermissionState | null>(push.isDevice ? null : 'unavailable');
  useEffect(() => {
    if (!push.isDevice) return undefined;
    let alive = true;
    const read = () => {
      push.permission().then(
        (p) => {
          if (alive) setState(p);
        },
        (e: unknown) => console.warn('[push] Could not read the notification permission', e instanceof Error ? e.message : 'unknown error'),
      );
    };
    read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [push]);
  return state;
}

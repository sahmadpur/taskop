import * as Network from 'expo-network';
import { AppState } from 'react-native';
import type { AppStatePort, NetworkPort } from '../sync-triggers';

export function expoNetwork(): NetworkPort {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  let subscription: { remove(): void } | null = null;
  const update = (s: Network.NetworkState) => {
    // Both fields are optional: only an explicit `false` means offline, so an unknown state never blocks sync.
    const next = s.isConnected !== false && s.isInternetReachable !== false;
    if (next === online) return;
    online = next;
    listeners.forEach((l) => l(online));
  };
  // Unreadable state: stay online and let the sync engine's own error handling decide.
  Network.getNetworkStateAsync().then(update, () => undefined);
  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      subscription ??= Network.addNetworkStateListener(update);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscription?.remove();
          subscription = null;
        }
      };
    },
  };
}

export function rnAppState(): AppStatePort {
  return {
    subscribe(listener) {
      const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
      return () => subscription.remove();
    },
  };
}

import type { SyncTrigger } from './sync-engine';

export interface NetworkPort {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface AppStatePort {
  /** `active` is true when the app comes to the foreground. */
  subscribe(listener: (active: boolean) => void): () => void;
}

export const SYNC_INTERVAL_MS = 30_000;
export const LOCAL_WRITE_DELAY_MS = 2_000;

export interface SyncTriggers {
  /** A local write happened: run 2 s after the last one. */
  requestSoon(): void;
  stop(): void;
}

/** Spec §7.2: app start, reconnect, foreground, every 30 s while online, 2 s after a local write. No background sync. */
export function startSyncTriggers(o: { run: (trigger: SyncTrigger) => void; network: NetworkPort; appState: AppStatePort }): SyncTriggers {
  let online = o.network.isOnline();
  let active = true;
  let soon: ReturnType<typeof setTimeout> | null = null;
  const offNetwork = o.network.subscribe((next) => {
    const was = online;
    online = next;
    if (next && !was) o.run('reconnect');
  });
  const offAppState = o.appState.subscribe((next) => {
    const was = active;
    active = next;
    if (next && !was) o.run('foreground');
  });
  const tick = setInterval(() => {
    if (online && active) o.run('interval');
  }, SYNC_INTERVAL_MS);
  o.run('start');
  return {
    requestSoon() {
      if (soon) clearTimeout(soon);
      soon = setTimeout(() => {
        soon = null;
        o.run('local');
      }, LOCAL_WRITE_DELAY_MS);
    },
    stop() {
      offNetwork();
      offAppState();
      clearInterval(tick);
      if (soon) clearTimeout(soon);
    },
  };
}

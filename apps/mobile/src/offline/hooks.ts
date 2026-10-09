import { useEffect, useState, useSyncExternalStore } from 'react';
import { useOffline } from './context';
import type { OfflineServices } from './services';
import type { SyncStatus } from './sync-engine';

/** Runs `query` now and again after every local change or sync result. `undefined` while the first run is pending. */
export function useLiveQuery<T>(query: (s: OfflineServices) => Promise<T>, deps: readonly unknown[]): T | undefined {
  const services = useOffline();
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void query(services).then((v) => {
        if (alive) setValue(v);
      });
    };
    load();
    const off = services.feed.subscribe(load);
    return () => {
      alive = false;
      off();
    };
    // `deps` lists what `query` reads; the repo's ESLint config has no react-hooks plugin to check it.
  }, [services, ...deps]);
  return value;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useOffline();
  return useSyncExternalStore(engine.subscribe, engine.status);
}

/** The offline clock's time, refreshed on an interval and on every change (so a passed closes_at shows promptly). */
export function useNow(intervalMs = 15_000): number {
  const { clock, feed } = useOffline();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const tick = () => setNow(clock.now());
    const id = setInterval(tick, intervalMs);
    const off = feed.subscribe(tick);
    return () => {
      clearInterval(id);
      off();
    };
  }, [clock, feed, intervalMs]);
  return now;
}

import type { SyncTrigger } from './sync-engine';
import { type AppStatePort, LOCAL_WRITE_DELAY_MS, type NetworkPort, startSyncTriggers, SYNC_INTERVAL_MS } from './sync-triggers';

function ports(online: boolean) {
  const netListeners = new Set<(o: boolean) => void>();
  const appListeners = new Set<(a: boolean) => void>();
  let isOnline = online;
  const network: NetworkPort = {
    isOnline: () => isOnline,
    subscribe: (l) => {
      netListeners.add(l);
      return () => netListeners.delete(l);
    },
  };
  const appState: AppStatePort = {
    subscribe: (l) => {
      appListeners.add(l);
      return () => appListeners.delete(l);
    },
  };
  return {
    network,
    appState,
    setOnline(o: boolean) {
      isOnline = o;
      netListeners.forEach((l) => l(o));
    },
    setActive: (a: boolean) => appListeners.forEach((l) => l(a)),
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('sync triggers', () => {
  it('runs on start, on reconnect and on returning to the foreground', () => {
    const p = ports(false);
    const runs: SyncTrigger[] = [];
    const t = startSyncTriggers({ run: (x) => runs.push(x), network: p.network, appState: p.appState });
    p.setOnline(false);
    p.setOnline(true);
    p.setOnline(true);
    p.setActive(false);
    p.setActive(true);
    expect(runs).toEqual(['start', 'reconnect', 'foreground']);
    t.stop();
  });

  it('runs every 30 s only while online and in the foreground, and never after stop', () => {
    const p = ports(true);
    const runs: SyncTrigger[] = [];
    const t = startSyncTriggers({ run: (x) => runs.push(x), network: p.network, appState: p.appState });
    jest.advanceTimersByTime(SYNC_INTERVAL_MS * 2);
    expect(runs).toEqual(['start', 'interval', 'interval']);
    p.setOnline(false);
    jest.advanceTimersByTime(SYNC_INTERVAL_MS);
    p.setOnline(true);
    p.setActive(false);
    jest.advanceTimersByTime(SYNC_INTERVAL_MS);
    expect(runs).toEqual(['start', 'interval', 'interval', 'reconnect']);
    t.stop();
    p.setActive(true);
    jest.advanceTimersByTime(SYNC_INTERVAL_MS * 5);
    expect(runs).toHaveLength(4);
  });

  it('runs once, 2 s after the last of several local writes', () => {
    const p = ports(true);
    const runs: SyncTrigger[] = [];
    const t = startSyncTriggers({ run: (x) => runs.push(x), network: p.network, appState: p.appState });
    t.requestSoon();
    jest.advanceTimersByTime(1_500);
    t.requestSoon();
    jest.advanceTimersByTime(LOCAL_WRITE_DELAY_MS - 1);
    expect(runs).toEqual(['start']);
    jest.advanceTimersByTime(1);
    expect(runs).toEqual(['start', 'local']);
    t.stop();
  });
});

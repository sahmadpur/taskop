import type { DeviceInfo } from '@taskop/contracts';
import { type ChangeFeed, createChangeFeed } from './change-feed';
import type { Clock } from './clock';
import { type Db, migrate } from './db';
import { createExecutionStore, type ExecutionStore } from './execution-store';
import { createMediaQueue, type MediaQueue, type MediaTransport } from './media-queue';
import type { SyncApi } from './sync-api';
import { type ClaimRejection, createSyncEngine, type SyncEngine, type SyncTrigger } from './sync-engine';
import { type AppStatePort, type NetworkPort, startSyncTriggers, type SyncTriggers } from './sync-triggers';
import { clearLocalData, ensureUser } from './user-scope';

/** How long a logout or a user switch waits for a running sync to end. */
export const SHUTDOWN_WAIT_MS = 10_000;

export interface ServiceDeps {
  db: Db;
  api: SyncApi;
  clock: Clock;
  newId: () => string;
  device: DeviceInfo;
  transport: MediaTransport;
  isOnline: () => boolean;
  /** Absent in tests: runs then happen only when a test asks. */
  triggers?: { network: NetworkPort; appState: AppStatePort };
  onClaimRejected: (r: ClaimRejection) => void;
}

export interface OfflineServices {
  readonly userId: string;
  readonly timeZone: string;
  readonly db: Db;
  readonly clock: Clock;
  readonly feed: ChangeFeed;
  readonly store: ExecutionStore;
  readonly engine: SyncEngine;
  readonly mediaQueue: MediaQueue;
  syncNow(trigger?: SyncTrigger): Promise<void>;
  /** Logout: stop syncing, wait for a running sync, then delete every row and file. */
  clearAll(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createOfflineServices(deps: ServiceDeps, userId: string, timeZone: string): Promise<OfflineServices> {
  const { db, api, clock, transport } = deps;
  await migrate(db);
  // Before anything can sync: another user's data must never go out with this user's token (spec §7.2).
  await ensureUser(db, userId, transport);
  const feed = createChangeFeed();
  let triggers: SyncTriggers | null = null;
  const mediaQueue = createMediaQueue({ db, userId, api, clock, transport, feed, isOnline: deps.isOnline });
  const store = createExecutionStore({
    db,
    clock,
    newId: deps.newId,
    device: deps.device,
    files: transport,
    feed,
    // An online start claims at once (spec §1); other changes wait 2 s for more edits.
    onWrite: (kind) => (kind === 'claim' ? void engine.run('claim') : triggers?.requestSoon()),
  });
  const engine = createSyncEngine({
    db,
    userId,
    api,
    clock,
    feed,
    mediaQueue,
    files: transport,
    isOnline: deps.isOnline,
    onClaimRejected: deps.onClaimRejected,
    beforeRun: () => store.lockExpired(),
  });
  await store.lockExpired();
  await engine.refresh();
  const unsubscribe: (() => void)[] = [];
  if (deps.triggers) {
    const { network, appState } = deps.triggers;
    unsubscribe.push(network.subscribe(() => void engine.refresh()));
    triggers = startSyncTriggers({ run: (trigger) => void engine.run(trigger), network, appState });
  }
  const shutDown = async () => {
    triggers?.stop();
    unsubscribe.splice(0).forEach((off) => off());
    engine.stop();
    // Requests and uploads are bounded, but a logout or a user switch must never hang on a run that does not end.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = await Promise.race([
      engine.idle().then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), SHUTDOWN_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (gaveUp) console.warn(`[offline] The running sync did not end within ${SHUTDOWN_WAIT_MS / 1000} s; shutting down anyway`);
  };
  return {
    userId,
    timeZone,
    db,
    clock,
    feed,
    store,
    engine,
    mediaQueue,
    syncNow: (trigger = 'manual') => engine.run(trigger),
    async clearAll() {
      await shutDown();
      await clearLocalData(db, transport);
      feed.emit();
    },
    dispose: shutDown,
  };
}

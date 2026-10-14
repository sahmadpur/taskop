import type { DeviceInfo } from '@taskop/contracts';
import { type ChangeFeed, createChangeFeed } from './change-feed';
import type { Clock } from './clock';
import { type Db, migrate, setMeta } from './db';
import { createExecutionStore, type ExecutionStore, type WriteKind } from './execution-store';
import { createMediaQueue, type MediaQueue, type MediaTransport } from './media-queue';
import type { SyncApi } from './sync-api';
import { type ClaimRejection, createSyncEngine, type SyncEngine, type SyncTrigger } from './sync-engine';
import type { TaskRemoved } from './task-records';
import { createTaskStore, type TaskStore } from './task-store';
import { type AppStatePort, type NetworkPort, startSyncTriggers, type SyncTriggers } from './sync-triggers';
import { clearLocalData, ensureUser, type FileRemover, NOT_OWNER, ownedTransaction } from './user-scope';

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
  onTaskRemoved: (r: TaskRemoved) => void;
  /** Every unread count the phone learns (a pull or the inbox): the app badge (spec §7.3). */
  onUnreadNotifications?: (count: number) => void;
}

export interface OfflineServices {
  readonly userId: string;
  readonly timeZone: string;
  readonly db: Db;
  readonly clock: Clock;
  readonly feed: ChangeFeed;
  readonly store: ExecutionStore;
  readonly tasks: TaskStore;
  /** Client UUIDv7s (a task created online, spec §6.2). */
  readonly newId: () => string;
  /** Deletes local files (photos taken for a task that was never created). */
  readonly files: FileRemover;
  readonly engine: SyncEngine;
  readonly mediaQueue: MediaQueue;
  syncNow(trigger?: SyncTrigger): Promise<void>;
  /** The inbox read a fresh unread count: stored for the bell and handed to the badge. Nothing is written once the user changed or the services were shut down. */
  setUnreadNotifications(count: number): Promise<void>;
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
  // An online start or accept syncs at once (spec §1, decision 15); other changes wait 2 s for more edits.
  const onWrite = (kind: WriteKind) => (kind === 'claim' ? void engine.run('claim') : triggers?.requestSoon());
  const store = createExecutionStore({ db, clock, newId: deps.newId, device: deps.device, files: transport, feed, onWrite });
  const tasks = createTaskStore({ db, clock, newId: deps.newId, files: transport, feed, onWrite });
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
    onTaskRemoved: deps.onTaskRemoved,
    onUnreadNotifications: deps.onUnreadNotifications,
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
  let shutting = false;
  const shutDown = async () => {
    shutting = true;
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
    tasks,
    newId: deps.newId,
    files: transport,
    engine,
    mediaQueue,
    syncNow: (trigger = 'manual') => engine.run(trigger),
    async setUnreadNotifications(count) {
      if (shutting) return;
      const n = Math.max(0, Math.floor(count));
      const written = await ownedTransaction(db, userId, (tx) => setMeta(tx, 'unreadNotifications', String(n)));
      if (written === NOT_OWNER || shutting) return;
      feed.emit();
      deps.onUnreadNotifications?.(n);
    },
    async clearAll() {
      await shutDown();
      await clearLocalData(db, transport);
      feed.emit();
    },
    dispose: shutDown,
  };
}

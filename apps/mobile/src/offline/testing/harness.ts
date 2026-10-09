import type { SyncResponse } from '@taskop/contracts';
import { type ChangeFeed, createChangeFeed } from '../change-feed';
import type { Db } from '../db';
import { createExecutionStore, type ExecutionStore, type WriteKind } from '../execution-store';
import { applyPull } from '../sync-pull';
import { ensureUser } from '../user-scope';
import { createFakeTransport, type FakeTransport } from './fake-transport';
import { type Checklist, checklist, DEVICE, ME, manualClock, type ManualClock, syncResponse, T, testIds, versionOf } from './fixtures';
import { openTestDb } from './node-db';

export interface Harness {
  db: Db;
  clock: ManualClock;
  feed: ChangeFeed;
  transport: FakeTransport;
  store: ExecutionStore;
  /** Every onWrite call, in order. */
  writes: WriteKind[];
  c: Checklist;
  /** Applies a /me/sync response; the default is one open occurrence (OCC) and its version. */
  seed(res?: SyncResponse): Promise<void>;
}

export async function createHarness(o: { at?: string; db?: Db } = {}): Promise<Harness> {
  const db = o.db ?? (await openTestDb());
  const clock = manualClock(o.at ?? T.open);
  const feed = createChangeFeed();
  const transport = createFakeTransport();
  await ensureUser(db, ME, transport);
  const writes: WriteKind[] = [];
  const store = createExecutionStore({ db, clock, newId: testIds(clock), device: DEVICE, files: transport, feed, onWrite: (kind) => writes.push(kind) });
  const c = checklist();
  const seed = async (res: SyncResponse = syncResponse({ checklistVersions: [versionOf(c.content)] })) => {
    await applyPull(db, res, 0, clock.now());
    feed.emit();
  };
  await seed();
  return { db, clock, feed, transport, store, writes, c, seed };
}

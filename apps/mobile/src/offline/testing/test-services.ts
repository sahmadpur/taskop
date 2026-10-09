import type { SyncResponse } from '@taskop/contracts';
import type { Db } from '../db';
import { createOfflineServices, type OfflineServices } from '../services';
import type { ClaimRejection } from '../sync-engine';
import { applyPull } from '../sync-pull';
import { createFakeApi, type FakeApi } from './fake-api';
import { createFakeTransport, type FakeTransport } from './fake-transport';
import { type Checklist, checklist, DEVICE, ME, manualClock, type ManualClock, syncResponse, T, testIds, versionOf } from './fixtures';
import { openTestDb } from './node-db';

export interface TestServices {
  services: OfflineServices;
  api: FakeApi;
  clock: ManualClock;
  transport: FakeTransport;
  db: Db;
  /** The services' isOnline() reads this. Offline by default, so actions never sync behind a test's back. */
  net: { online: boolean };
  rejections: ClaimRejection[];
  c: Checklist;
  /** Applies a /me/sync response (default: OCC open and its version) and refreshes the sync status. */
  seed(res?: SyncResponse): Promise<void>;
}

export async function createTestServices(
  o: { at?: string; userId?: string; db?: Db; transport?: FakeTransport; online?: boolean } = {},
): Promise<TestServices> {
  const db = o.db ?? (await openTestDb());
  const clock = manualClock(o.at ?? T.open);
  const api = createFakeApi();
  const transport = o.transport ?? createFakeTransport();
  const net = { online: o.online ?? false };
  const rejections: ClaimRejection[] = [];
  const services = await createOfflineServices(
    { db, api: api.api, clock, newId: testIds(clock), device: DEVICE, transport, isOnline: () => net.online, onClaimRejected: (r) => rejections.push(r) },
    o.userId ?? ME,
    'Asia/Baku',
  );
  const c = checklist();
  const seed = async (res: SyncResponse = syncResponse({ checklistVersions: [versionOf(c.content)] })) => {
    await applyPull(db, res, 0, clock.now());
    services.feed.emit();
    await services.engine.refresh();
  };
  return { services, api, clock, transport, db, net, rejections, c, seed };
}

import { getRandomBytes } from 'expo-crypto';
import { api } from '@/lib/session';
import { systemClock } from '../clock';
import { uuidv7 } from '../ids';
import { createOfflineServices, type OfflineServices } from '../services';
import { createSessionQueue, type Session } from '../session-queue';
import type { ClaimRejection } from '../sync-engine';
import { deviceInfo } from './device';
import { nativeMediaFiles } from './media-files';
import { openEncryptedDatabase } from './open-database';
import { expoNetwork, rnAppState } from './ports';

/**
 * Every open and close of the one database file runs alone, in call order: user B's services (whose ensureUser may
 * clear the tables) are created only after user A's engine has stopped, its last run has ended and its connection
 * is closed. This also keeps two connections, two engines or two key generations from ever existing at once.
 */
const sessions = createSessionQueue();

export function openNativeServices(userId: string, timeZone: string, hooks: { onClaimRejected: (r: ClaimRejection) => void }): Session<OfflineServices> {
  return sessions.open(async () => {
    const db = await openEncryptedDatabase();
    const network = expoNetwork();
    let services: OfflineServices;
    try {
      services = await createOfflineServices(
        {
          db,
          api,
          clock: systemClock,
          newId: () => uuidv7(Date.now(), getRandomBytes),
          device: deviceInfo(),
          transport: nativeMediaFiles,
          isOnline: () => network.isOnline(),
          triggers: { network, appState: rnAppState() },
          onClaimRejected: hooks.onClaimRejected,
        },
        userId,
        timeZone,
      );
    } catch (e) {
      await db.close();
      throw e;
    }
    return {
      value: services,
      async dispose() {
        try {
          await services.dispose();
        } finally {
          await db.close();
        }
      },
    };
  });
}

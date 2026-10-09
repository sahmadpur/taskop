import { getRandomBytes } from 'expo-crypto';
import { api } from '@/lib/session';
import { systemClock } from '../clock';
import { uuidv7 } from '../ids';
import { createOfflineServices, type OfflineServices } from '../services';
import type { ClaimRejection } from '../sync-engine';
import { deviceInfo } from './device';
import { nativeMediaFiles } from './media-files';
import { openEncryptedDatabase } from './open-database';
import { expoNetwork, rnAppState } from './ports';

/** The previous user's connection must be closed before the next one opens the same file. */
let closing: Promise<void> = Promise.resolve();

export async function createNativeServices(
  userId: string,
  timeZone: string,
  hooks: { onClaimRejected: (r: ClaimRejection) => void },
): Promise<OfflineServices> {
  await closing;
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
    ...services,
    async dispose() {
      await services.dispose();
      closing = db.close();
      await closing;
    },
  };
}

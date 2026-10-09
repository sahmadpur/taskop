import { type Db, getMeta, setMeta } from './db';

export interface FileRemover {
  remove(uri: string): void;
}

/** Deletes every local row and media file (logout, or a different user signing in). */
export async function clearLocalData(db: Db, files: FileRemover): Promise<void> {
  const media = await db.all<{ local_uri: string }>('SELECT local_uri FROM media WHERE file_deleted_at IS NULL');
  await db.transaction(async (tx) => {
    for (const table of ['outbox', 'media', 'media_refusals', 'executions', 'occurrences', 'checklist_versions', 'meta']) await tx.run(`DELETE FROM ${table}`);
  });
  for (const m of media) {
    try {
      files.remove(m.local_uri);
    } catch {
      // Already gone: nothing to protect.
    }
  }
}

/** What `ownedTransaction` returns instead of running when another user (or nobody) is signed in now. */
export const NOT_OWNER = Symbol('not owner');

/**
 * For writing what a request or an upload brought back: a logout or a user switch may have cleared the store while it
 * was in flight (the shutdown wait gives up before a request must end). The check runs inside the transaction, so once
 * `userId` is no longer the signed-in user nothing is written for them.
 */
export function ownedTransaction<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T | typeof NOT_OWNER> {
  return db.transaction(async (tx) => ((await getMeta(tx, 'userId')) === userId ? fn(tx) : NOT_OWNER));
}

/** Runs before the sync engine starts: data of any other user must never be sent with this user's token (spec §7.2). */
export async function ensureUser(db: Db, userId: string, files: FileRemover): Promise<'same' | 'switched' | 'fresh'> {
  const current = await getMeta(db, 'userId');
  if (current === userId) return 'same';
  await clearLocalData(db, files);
  await setMeta(db, 'userId', userId);
  return current === null ? 'fresh' : 'switched';
}

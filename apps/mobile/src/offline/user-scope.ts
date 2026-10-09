import { type Db, getMeta, setMeta } from './db';

export interface FileRemover {
  remove(uri: string): void;
}

/** Deletes every local row and media file (logout, or a different user signing in). */
export async function clearLocalData(db: Db, files: FileRemover): Promise<void> {
  const media = await db.all<{ local_uri: string }>('SELECT local_uri FROM media WHERE file_deleted_at IS NULL');
  await db.transaction(async (tx) => {
    for (const table of ['outbox', 'media', 'executions', 'occurrences', 'checklist_versions', 'meta']) await tx.run(`DELETE FROM ${table}`);
  });
  for (const m of media) {
    try {
      files.remove(m.local_uri);
    } catch {
      // Already gone: nothing to protect.
    }
  }
}

/** Runs before the sync engine starts: data of any other user must never be sent with this user's token (spec §7.2). */
export async function ensureUser(db: Db, userId: string, files: FileRemover): Promise<'same' | 'switched' | 'fresh'> {
  const current = await getMeta(db, 'userId');
  if (current === userId) return 'same';
  await clearLocalData(db, files);
  await setMeta(db, 'userId', userId);
  return current === null ? 'fresh' : 'switched';
}

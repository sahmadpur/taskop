import type { SqlDriver } from './db';

export class CipherUnavailableError extends Error {
  constructor() {
    super('SQLCipher is not active: refusing to store data unencrypted');
    this.name = 'CipherUnavailableError';
  }
}

/** SQLITE_NOTADB: the file was encrypted with another key (or is not a database). Nothing else resets the file. */
export const isWrongKeyError = (e: unknown): boolean => /file is not a database/i.test(String(e));

/**
 * Keys a fresh connection and checks it. The key must be the first statement; a raw hex key skips SQLCipher's key
 * derivation. Plain SQLite ignores `PRAGMA key` silently, so `cipher_version` proves encryption is on (fail closed).
 */
export async function applyKey(conn: Pick<SqlDriver, 'exec' | 'all'>, hexKey: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('The database key must be 64 lowercase hex characters');
  await conn.exec(`PRAGMA key = "x'${hexKey}'"`);
  const [row] = await conn.all<{ cipher_version?: unknown }>('PRAGMA cipher_version', []);
  if (typeof row?.cipher_version !== 'string' || row.cipher_version.length === 0) throw new CipherUnavailableError();
  await conn.all('SELECT count(*) AS n FROM sqlite_master', []); // "file is not a database" on a wrong key
  await conn.exec('PRAGMA journal_mode = WAL');
}

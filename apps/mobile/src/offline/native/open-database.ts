import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { createDb, type Db, type SqlDriver, type SqlValue } from '../db';

const DB_NAME = 'taskop.db';
const KEY_NAME = 'taskop.dbKey';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** 32 random bytes per install, kept in the keychain/keystore and never leaving the device (FR-10.10). */
async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const key = toHex(getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return key;
}

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => (await db.runAsync(sql, params)).changes,
    all: <T>(sql: string, params: SqlValue[]) => db.getAllAsync<T>(sql, params),
    close: () => db.closeAsync(),
  };
}

async function openWithKey(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  try {
    // The key must be the first statement on the connection; a raw hex key skips SQLCipher's key derivation.
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master'); // "file is not a database" on a wrong key
    await db.execAsync('PRAGMA journal_mode = WAL');
    return db;
  } catch (e) {
    await db.closeAsync().catch(() => undefined);
    throw e;
  }
}

/**
 * Opens the encrypted database. A file the stored key cannot open (the keychain was restored without it) is
 * unreadable anyway: it is deleted and recreated empty, and the next sync downloads the user's data again.
 */
export async function openEncryptedDatabase(): Promise<Db> {
  const key = await databaseKey();
  try {
    return createDb(expoDriver(await openWithKey(key)));
  } catch (e) {
    if (!/not a database|encrypted/i.test(String(e))) throw e;
    await SQLite.deleteDatabaseAsync(DB_NAME);
    return createDb(expoDriver(await openWithKey(key)));
  }
}

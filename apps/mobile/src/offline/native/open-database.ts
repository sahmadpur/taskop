import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { createDb, type Db, type SqlDriver, type SqlValue } from '../db';
import { applyKey, isWrongKeyError } from '../sqlcipher';

const DB_NAME = 'taskop.db';
const KEY_NAME = 'taskop.dbKey';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** One read-or-create per process: concurrent callers share it, so two different keys are never generated. */
let keyPromise: Promise<string> | null = null;

/** 32 random bytes per install, kept in the keychain/keystore and never leaving the device (FR-10.10). */
function databaseKey(): Promise<string> {
  keyPromise ??= (async () => {
    const existing = await SecureStore.getItemAsync(KEY_NAME);
    if (existing) return existing;
    const key = toHex(getRandomBytes(32));
    await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    return key;
  })().catch((e: unknown) => {
    keyPromise = null; // let the next attempt read the keychain again
    throw e;
  });
  return keyPromise;
}

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => (await db.runAsync(sql, params)).changes,
    all: <T>(sql: string, params: SqlValue[]) => db.getAllAsync<T>(sql, params),
    close: () => db.closeAsync(),
  };
}

async function openWithKey(key: string): Promise<SqlDriver> {
  const driver = expoDriver(await SQLite.openDatabaseAsync(DB_NAME));
  try {
    await applyKey(driver, key);
    return driver;
  } catch (e) {
    await driver.close().catch(() => undefined);
    throw e;
  }
}

/**
 * Opens the encrypted database. A file the stored key cannot open (the keychain was restored without it) is
 * unreadable anyway: it is deleted and recreated empty, and the next sync downloads the user's data again.
 * Callers must not open it twice at once: create-native-services serialises every open and close.
 */
export async function openEncryptedDatabase(): Promise<Db> {
  const key = await databaseKey();
  try {
    return createDb(await openWithKey(key));
  } catch (e) {
    if (!isWrongKeyError(e)) throw e;
    console.warn('[offline] The local database cannot be read with the stored key; it is reset and downloaded again.');
    await SQLite.deleteDatabaseAsync(DB_NAME);
    return createDb(await openWithKey(key));
  }
}

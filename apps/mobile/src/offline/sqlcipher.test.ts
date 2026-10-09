import type { SqlValue } from './db';
import { applyKey, CipherUnavailableError, isWrongKeyError } from './sqlcipher';
import { nodeDriver } from './testing/node-db';

const KEY = 'ab'.repeat(32);

function fakeConn(cipherVersion: unknown) {
  const statements: string[] = [];
  return {
    statements,
    exec: async (sql: string) => {
      statements.push(sql);
    },
    all: async <T>(sql: string, _params: SqlValue[]) => {
      statements.push(sql);
      if (sql === 'PRAGMA cipher_version') return (cipherVersion === undefined ? [] : [{ cipher_version: cipherVersion }]) as T[];
      return [{ n: 0 }] as T[];
    },
  };
}

describe('applyKey', () => {
  it('keys first, checks SQLCipher is active, then checks the key and turns on WAL', async () => {
    const c = fakeConn('4.6.1 community');
    await applyKey(c, KEY);
    expect(c.statements).toEqual([`PRAGMA key = "x'${KEY}'"`, 'PRAGMA cipher_version', 'SELECT count(*) AS n FROM sqlite_master', 'PRAGMA journal_mode = WAL']);
  });

  it('fails closed when SQLCipher is not active, before touching the file', async () => {
    for (const v of [undefined, '', null]) {
      const c = fakeConn(v);
      await expect(applyKey(c, KEY)).rejects.toBeInstanceOf(CipherUnavailableError);
      expect(c.statements).toEqual([`PRAGMA key = "x'${KEY}'"`, 'PRAGMA cipher_version']);
    }
  });

  it('fails closed on plain SQLite, which ignores PRAGMA key', async () => {
    const driver = nodeDriver();
    await expect(applyKey(driver, KEY)).rejects.toBeInstanceOf(CipherUnavailableError);
    await driver.close();
  });

  it('refuses a key that is not 64 hex characters', async () => {
    const c = fakeConn('4.6.1');
    await expect(applyKey(c, `${'ab'.repeat(31)}"'`)).rejects.toThrow('64 lowercase hex');
    expect(c.statements).toEqual([]);
  });
});

describe('isWrongKeyError', () => {
  it('matches only SQLITE_NOTADB', () => {
    expect(isWrongKeyError(new Error('Call to function NativeDatabase.execAsync has been rejected. → file is not a database'))).toBe(true);
    expect(isWrongKeyError(new Error('database disk image is malformed'))).toBe(false);
    expect(isWrongKeyError(new Error('encrypted something'))).toBe(false);
    expect(isWrongKeyError(new CipherUnavailableError())).toBe(false);
  });
});

import { createDb, type Db, migrate, type SqlDriver, type SqlValue } from '../db';

type NodeSqlite = typeof import('node:sqlite');

/**
 * Node 24's built-in SQLite, loaded through process.getBuiltinModule so Jest's module resolver never sees it.
 * Test-only: nothing in the app imports this file.
 */
export function nodeDriver(path = ':memory:'): SqlDriver {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as NodeSqlite;
  const db = new DatabaseSync(path);
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params) => Number(db.prepare(sql).run(...params).changes),
    all: async <T>(sql: string, params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
    close: async () => {
      db.close();
    },
  };
}

export async function openTestDb(driver: SqlDriver = nodeDriver()): Promise<Db> {
  const db = createDb(driver);
  await migrate(db);
  return db;
}

/** A driver that throws "simulated crash" on statements matching `pattern` once `armed` is set: an app kill mid-action. */
export function failingDriver(base: SqlDriver, pattern: RegExp): SqlDriver & { armed: boolean } {
  const driver = {
    ...base,
    armed: false,
    run: async (sql: string, params: SqlValue[]) => {
      if (driver.armed && pattern.test(sql)) throw new Error('simulated crash');
      return base.run(sql, params);
    },
  };
  return driver;
}

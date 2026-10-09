export type SqlValue = string | number | null;

/** The primitives a SQLite engine provides: expo-sqlite on the phone, node:sqlite in Jest. */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  /** Returns the number of changed rows. */
  run(sql: string, params: SqlValue[]): Promise<number>;
  all<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<number>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** All-or-nothing. Inside `fn` use only `tx`: the outer handle would wait for this transaction to end. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * One connection, one queue: every statement and every transaction runs alone, in call order.
 * expo-sqlite's withTransactionAsync lets other queries interleave, and withExclusiveTransactionAsync opens a
 * second connection that would not carry the SQLCipher key, so atomicity comes from this queue instead.
 */
export function createDb(driver: SqlDriver): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job, job);
    tail = result.catch(() => undefined);
    return result;
  };
  const inTransaction: Db = {
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => driver.run(sql, params),
    all: <T>(sql: string, params: SqlValue[] = []) => driver.all<T>(sql, params),
    first: async <T>(sql: string, params: SqlValue[] = []) => (await driver.all<T>(sql, params))[0] ?? null,
    transaction: () => Promise.reject(new Error('Nested transactions are not supported')),
    close: () => Promise.reject(new Error('Cannot close the database inside a transaction')),
  };
  return {
    exec: (sql) => enqueue(() => driver.exec(sql)),
    run: (sql, params = []) => enqueue(() => driver.run(sql, params)),
    all: <T>(sql: string, params: SqlValue[] = []) => enqueue(() => driver.all<T>(sql, params)),
    first: <T>(sql: string, params: SqlValue[] = []) => enqueue(async () => (await driver.all<T>(sql, params))[0] ?? null),
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      enqueue(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(inTransaction);
          await driver.exec('COMMIT');
          return result;
        } catch (e) {
          await driver.exec('ROLLBACK').catch(() => undefined);
          throw e;
        }
      }),
    close: () => enqueue(() => driver.close()),
  };
}

/** Forward-only. Never edit a shipped entry: append a new one. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE occurrences (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL,
    checklist_name TEXT NOT NULL,
    site_id TEXT NOT NULL,
    site_name TEXT NOT NULL,
    shift_name TEXT,
    local_date TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    status TEXT NOT NULL,
    checklist_version_id TEXT NOT NULL,
    claim_execution_id TEXT,
    claim_user_id TEXT,
    claim_name TEXT
  );
  CREATE TABLE checklist_versions (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE TABLE executions (
    id TEXT PRIMARY KEY,
    occurrence_id TEXT NOT NULL,
    checklist_version_id TEXT NOT NULL,
    state TEXT NOT NULL,
    claim TEXT NOT NULL,
    rejected_reason TEXT,
    rejected_by TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    locked_at TEXT,
    answers TEXT NOT NULL DEFAULT '{}',
    rev INTEGER NOT NULL DEFAULT 0,
    synced_rev INTEGER NOT NULL DEFAULT 0,
    finished_synced_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX executions_occurrence ON executions (occurrence_id);
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    item_id TEXT,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    captured_at TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    registered_at TEXT,
    uploaded_at TEXT,
    failed_code TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    file_deleted_at TEXT
  );
  CREATE INDEX media_execution ON media (execution_id);
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT,
    rev INTEGER,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_key TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX outbox_execution ON outbox (execution_id, kind);
  `,
];

export async function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): Promise<number> {
  const from = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (from > migrations.length) throw new Error(`Local database version ${from} is newer than this app (${migrations.length})`);
  for (let version = from; version < migrations.length; version++) {
    await db.transaction(async (tx) => {
      await tx.exec(migrations[version]!);
      await tx.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return migrations.length;
}

export type MetaKey = 'userId' | 'clockOffsetMs' | 'lastSyncedAt';

export async function getMeta(db: Db, key: MetaKey): Promise<string | null> {
  return (await db.first<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))?.value ?? null;
}

export async function setMeta(db: Db, key: MetaKey, value: string): Promise<void> {
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

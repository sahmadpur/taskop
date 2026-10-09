import { createDb, getMeta, migrate, MIGRATIONS, setMeta, type SqlDriver } from './db';
import { nodeDriver } from './testing/node-db';

const tables = async (db: ReturnType<typeof createDb>) =>
  (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).map((r) => r.name);

describe('local database', () => {
  it('creates every table on a fresh database and records the schema version', async () => {
    const db = createDb(nodeDriver());
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await tables(db)).toEqual(['checklist_versions', 'executions', 'media', 'media_refusals', 'meta', 'occurrences', 'outbox']);
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: MIGRATIONS.length });
  });

  it('upgrades a version 1 database in place, keeping its executions', async () => {
    const db = createDb(nodeDriver());
    await migrate(db, MIGRATIONS.slice(0, 1));
    await db.run(
      `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES ('e', 'o', 'v', 'active', 'accepted', 's', 'u')`,
    );
    expect(await migrate(db)).toBe(2);
    expect(await db.first('SELECT id, sync_note FROM executions')).toEqual({ id: 'e', sync_note: null });
    expect(await db.first('SELECT count(*) AS n FROM media_refusals')).toEqual({ n: 0 });
  });

  it('does nothing when already migrated and keeps the data', async () => {
    const db = createDb(nodeDriver());
    await migrate(db);
    await setMeta(db, 'userId', 'u1');
    await migrate(db);
    expect(await getMeta(db, 'userId')).toBe('u1');
  });

  it('runs each migration in its own transaction and stops at the first failing one', async () => {
    const db = createDb(nodeDriver());
    const steps = ['CREATE TABLE a (x INTEGER)', 'CREATE TABLE b (y INTEGER); INSERT INTO nope VALUES (1)'];
    await expect(migrate(db, steps)).rejects.toThrow(/no such table: nope/);
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 1 });
    expect(await tables(db)).toEqual(['a']);
  });

  it('refuses a database written by a newer app version', async () => {
    const db = createDb(nodeDriver());
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow('Local database version 99 is newer than this app');
  });

  it('rolls a transaction back when its callback throws', async () => {
    const db = createDb(nodeDriver());
    await migrate(db);
    await expect(
      db.transaction(async (tx) => {
        await setMeta(tx, 'userId', 'u1');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await getMeta(db, 'userId')).toBeNull();
  });

  it('runs statements and transactions one at a time, in call order', async () => {
    const base = nodeDriver();
    const log: string[] = [];
    const slow: SqlDriver = {
      ...base,
      run: async (sql, params) => {
        log.push(`start ${String(params[0])}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const n = await base.run(sql, params);
        log.push(`end ${String(params[0])}`);
        return n;
      },
    };
    const db = createDb(slow);
    await migrate(db);
    const insert = `INSERT INTO meta (key, value) VALUES (?, 'x')`;
    const tx = db.transaction(async (t) => {
      await t.run(insert, ['a']);
      await t.run(insert, ['b']);
    });
    const outside = db.run(insert, ['c']);
    await Promise.all([tx, outside]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});

import { createDb, type Db, migrate, MIGRATIONS, setMeta } from './db';
import { appendCommand, listCommands, nextCommand } from './outbox';
import { DEVICE, ME, OCC, T, VERSION } from './testing/fixtures';
import { createHarness } from './testing/harness';
import { nodeDriver } from './testing/node-db';

const EXEC = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';
const MEDIUM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e61';
const FILE = 'file:///doc/media/before-v3.jpg';

/** A version 2 database (sub-project 4) holding a started execution whose claim, media registration and answers are still queued. */
async function version2WithQueuedWork(): Promise<Db> {
  const db = createDb(nodeDriver());
  await migrate(db, MIGRATIONS.slice(0, 2));
  await setMeta(db, 'userId', ME);
  await db.run(
    `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, answers, rev, updated_at)
     VALUES (?, ?, ?, 'active', 'pending', ?, '{}', 1, ?)`,
    [EXEC, OCC, VERSION, T.open, T.open],
  );
  await db.run(
    `INSERT INTO media (id, execution_id, item_id, kind, source, mime, bytes, captured_at, local_uri) VALUES (?, ?, NULL, 'photo', 'camera', 'image/jpeg', 10, ?, ?)`,
    [MEDIUM, EXEC, T.open, FILE],
  );
  await db.run(`INSERT INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES ('r1', ?, 'i1', 'errors.MEDIA_TOO_LARGE', ?)`, [EXEC, T.open]);
  const queue = (kind: string, refId: string | null, rev: number | null, payload: unknown) =>
    db.run('INSERT INTO outbox (execution_id, kind, ref_id, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [EXEC, kind, refId, rev, JSON.stringify(payload), T.open]);
  await queue('claim', null, null, { id: EXEC, occurrenceId: OCC, startedAt: T.open, device: DEVICE });
  await queue('media', MEDIUM, null, { id: MEDIUM, itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, width: null, height: null, durationMs: null, capturedAt: T.open });
  await queue('answers', null, 1, { rev: 1, answers: {} });
  // An acknowledged command: its number (4) is used up although its row is gone.
  await queue('complete', null, 1, { rev: 1, answers: {}, completedAt: T.open });
  await db.run('DELETE FROM outbox WHERE seq = 4');
  return db;
}

describe('local database version 3', () => {
  it('moves queued execution commands, media and refusals to entity and owner columns, keeping ids and order', async () => {
    const db = await version2WithQueuedWork();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await db.all('SELECT seq, entity_type, entity_id, kind, ref_id, rev, status FROM outbox ORDER BY seq')).toEqual([
      { seq: 1, entity_type: 'execution', entity_id: EXEC, kind: 'claim', ref_id: null, rev: null, status: 'pending' },
      { seq: 2, entity_type: 'execution', entity_id: EXEC, kind: 'media', ref_id: MEDIUM, rev: null, status: 'pending' },
      { seq: 3, entity_type: 'execution', entity_id: EXEC, kind: 'answers', ref_id: null, rev: 1, status: 'pending' },
    ]);
    expect(await db.first('SELECT id, owner_type, owner_id, item_id, role, local_uri FROM media')).toEqual({
      id: MEDIUM, owner_type: 'execution', owner_id: EXEC, item_id: null, role: null, local_uri: FILE,
    });
    expect(await db.first('SELECT media_id, owner_type, owner_id, item_id FROM media_refusals')).toEqual({ media_id: 'r1', owner_type: 'execution', owner_id: EXEC, item_id: 'i1' });
    expect(await db.first('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_drafts) AS drafts')).toEqual({ tasks: 0, drafts: 0 });
  });

  it('numbers new commands above every number used before the upgrade', async () => {
    const db = await version2WithQueuedWork();
    await migrate(db);
    // A newer answers revision replaces the queued one (seq 3) and must not reuse the acknowledged number 4.
    await appendCommand(db, { entityType: 'execution', entityId: EXEC, kind: 'answers', rev: 2, payload: { rev: 2, answers: {} }, createdAt: T.open });
    expect((await listCommands(db)).map((c) => c.seq)).toEqual([1, 2, 5]);
    expect(await nextCommand(db)).toMatchObject({ seq: 1, entityType: 'execution', entityId: EXEC, kind: 'claim' });
  });

  it('still syncs the execution work queued before the upgrade', async () => {
    const db = await version2WithQueuedWork();
    await migrate(db);
    const h = await createHarness({ db });
    h.transport.files.add(FILE);
    await h.engine.run('manual');
    expect(h.api.calls.map((c) => c.method)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(await db.first('SELECT count(*) AS n FROM outbox')).toEqual({ n: 0 });
    expect(await db.first('SELECT uploaded_at FROM media')).toEqual({ uploaded_at: T.open });
  });

  it('leaves a version 2 database untouched when the app is killed during the upgrade, and upgrades on the next start', async () => {
    const base = nodeDriver();
    const v2 = createDb(base);
    await migrate(v2, MIGRATIONS.slice(0, 2));
    await v2.run(`INSERT INTO outbox (execution_id, kind, payload, created_at) VALUES ('e1', 'claim', '{}', ?)`, [T.open]);
    let killed = false;
    const killing = createDb({
      ...base,
      exec: async (sql) => {
        await base.exec(sql);
        // Every statement of the upgrade ran, but the app dies before COMMIT.
        if (!killed && sql.includes('outbox_v3')) {
          killed = true;
          throw new Error('simulated crash');
        }
      },
    });
    await expect(migrate(killing)).rejects.toThrow('simulated crash');
    expect(await killing.first('PRAGMA user_version')).toEqual({ user_version: 2 });
    expect(await killing.all('SELECT execution_id, kind FROM outbox')).toEqual([{ execution_id: 'e1', kind: 'claim' }]);
    expect(await migrate(killing)).toBe(MIGRATIONS.length);
    expect(await killing.all('SELECT entity_type, entity_id, kind FROM outbox')).toEqual([{ entity_type: 'execution', entity_id: 'e1', kind: 'claim' }]);
  });
});

import { getMeta, setMeta } from './db';
import { ME, OTHER, T } from './testing/fixtures';
import { openTestDb } from './testing/node-db';
import { ensureUser } from './user-scope';

const counts = async (db: Awaited<ReturnType<typeof openTestDb>>) => {
  const out: Record<string, number> = {};
  for (const t of ['occurrences', 'checklist_versions', 'executions', 'media', 'outbox']) {
    out[t] = (await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))!.n;
  }
  return out;
};

async function fill(db: Awaited<ReturnType<typeof openTestDb>>) {
  await db.run(`INSERT INTO occurrences (id, checklist_id, checklist_name, site_id, site_name, local_date, starts_at, due_at, closes_at, status, checklist_version_id) VALUES ('o', 'c', 'n', 's', 'sn', '2026-11-02', ?, ?, ?, 'pending', 'v')`, [T.starts, T.due, T.closes]);
  await db.run(`INSERT INTO checklist_versions (id, checklist_id, number, schema_version, content, received_at) VALUES ('v', 'c', 1, 1, '{}', ?)`, [T.open]);
  await db.run(`INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES ('e', 'o', 'v', 'active', 'pending', ?, ?)`, [T.open, T.open]);
  await db.run(`INSERT INTO media (id, execution_id, kind, source, mime, bytes, captured_at, local_uri) VALUES ('m', 'e', 'photo', 'camera', 'image/jpeg', 10, ?, 'file:///doc/media/m.jpg')`, [T.open]);
  await db.run(`INSERT INTO outbox (execution_id, kind, payload, created_at) VALUES ('e', 'claim', '{}', ?)`, [T.open]);
}

describe('user scope', () => {
  it('remembers the first user and keeps their data on the next start', async () => {
    const db = await openTestDb();
    expect(await ensureUser(db, ME, { remove: jest.fn() })).toBe('fresh');
    await fill(db);
    expect(await ensureUser(db, ME, { remove: jest.fn() })).toBe('same');
    expect(await counts(db)).toEqual({ occurrences: 1, checklist_versions: 1, executions: 1, media: 1, outbox: 1 });
  });

  it('clears every table and every media file when another user signs in', async () => {
    const db = await openTestDb();
    await ensureUser(db, ME, { remove: jest.fn() });
    await fill(db);
    await setMeta(db, 'clockOffsetMs', '1000');
    const remove = jest.fn();
    expect(await ensureUser(db, OTHER, { remove })).toBe('switched');
    expect(await counts(db)).toEqual({ occurrences: 0, checklist_versions: 0, executions: 0, media: 0, outbox: 0 });
    expect(remove).toHaveBeenCalledWith('file:///doc/media/m.jpg');
    expect(await getMeta(db, 'userId')).toBe(OTHER);
    expect(await getMeta(db, 'clockOffsetMs')).toBeNull();
  });

  it('clears leftovers that belong to no recorded user', async () => {
    const db = await openTestDb();
    await fill(db);
    expect(await ensureUser(db, ME, { remove: jest.fn() })).toBe('fresh');
    expect((await counts(db)).executions).toBe(0);
  });
});

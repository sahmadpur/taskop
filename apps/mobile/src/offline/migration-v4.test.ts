import { createDb, migrate, MIGRATIONS } from './db';
import { OCC, T, VERSION } from './testing/fixtures';
import { nodeDriver } from './testing/node-db';

describe('local database version 4', () => {
  it('adds the rework columns to existing executions, keeping their data', async () => {
    const db = createDb(nodeDriver());
    await migrate(db, MIGRATIONS.slice(0, 3));
    await db.run(
      `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, answers, rev, updated_at)
       VALUES ('e', ?, ?, 'completed', 'accepted', ?, '{"a":{"number":1}}', 2, ?)`,
      [OCC, VERSION, T.open, T.open],
    );
    expect(await migrate(db)).toBe(4);
    expect(MIGRATIONS).toHaveLength(4);
    expect(await db.first('SELECT id, state, rev, answers, rework_round, rework FROM executions')).toEqual({
      id: 'e', state: 'completed', rev: 2, answers: '{"a":{"number":1}}', rework_round: 0, rework: null,
    });
  });
});

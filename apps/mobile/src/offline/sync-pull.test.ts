import { getMeta } from './db';
import { appendCommand } from './outbox';
import { applyPull, knownVersionIds } from './sync-pull';
import { checklist, myExecution, OCC, OCC2, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION, VERSION2, versionOf } from './testing/fixtures';
import { openTestDb } from './testing/node-db';

const NOW = Date.parse(T.open);

describe('applying /me/sync', () => {
  it('stores occurrences, new checklist versions, the clock offset and the sync time', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, syncResponse({ occurrences: [occurrence({ startsAt: '2026-11-02T04:00:00Z' })], checklistVersions: [versionOf(c.content)] }), 120_000, NOW);
    expect(await db.first('SELECT id, starts_at, status, checklist_version_id FROM occurrences')).toEqual({
      id: OCC, starts_at: '2026-11-02T04:00:00.000Z', status: 'pending', checklist_version_id: VERSION,
    });
    expect(await getMeta(db, 'clockOffsetMs')).toBe('120000');
    expect(await getMeta(db, 'lastSyncedAt')).toBe(T.open);
    expect(await knownVersionIds(db)).toEqual([VERSION]);
    const stored = await db.first<{ content: string; schema_version: number }>('SELECT content, schema_version FROM checklist_versions');
    expect(JSON.parse(stored!.content)).toEqual(c.content);
  });

  it('updates claims and drops vanished occurrences unless the phone has an execution for them', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ occurrences: [occurrence(), occurrence({ id: OCC2 })] }), 0, NOW);
    await db.run(`INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES ('x', ?, ?, 'active', 'pending', ?, ?)`, [OCC2, VERSION, T.open, T.open]);
    const claim = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
    await applyPull(db, syncResponse({ occurrences: [occurrence({ status: 'started', claim })] }), 0, NOW);
    expect(await db.all('SELECT id, status, claim_user_id, claim_name FROM occurrences ORDER BY id')).toEqual([
      { id: OCC, status: 'started', claim_user_id: OTHER, claim_name: 'Murad Həsənov' },
      { id: OCC2, status: 'pending', claim_user_id: null, claim_name: null },
    ]);
    await db.run('DELETE FROM executions');
    await applyPull(db, syncResponse({ occurrences: [] }), 0, NOW);
    expect(await db.all('SELECT id FROM occurrences')).toEqual([]);
  });

  it('adds my executions from the server so a reinstalled phone can resume them', async () => {
    const db = await openTestDb();
    const answers = { [VERSION]: { number: 5 } };
    await applyPull(db, syncResponse({ executions: [myExecution({ answers, answersRev: 2 }), myExecution({ id: OTHER_EXECUTION, occurrenceId: OCC2, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED' })] }), 0, NOW);
    expect(await db.all('SELECT state, claim, rejected_reason, rev, synced_rev, answers FROM executions ORDER BY id')).toEqual([
      { state: 'rejected', claim: 'rejected', rejected_reason: 'ALREADY_CLAIMED', rev: 0, synced_rev: 0, answers: '{}' },
      { state: 'active', claim: 'accepted', rejected_reason: null, rev: 2, synced_rev: 2, answers: JSON.stringify(answers) },
    ]);
  });

  it('takes newer server answers only when nothing is queued locally, and keeps a local lock', async () => {
    const db = await openTestDb();
    const x = myExecution({ answersRev: 2, answers: { a: { number: 1 } } });
    await applyPull(db, syncResponse({ executions: [x] }), 0, NOW);
    await db.run(`UPDATE executions SET answers = '{"a":{"number":3}}', rev = 3`);
    await appendCommand(db, { executionId: x.id, kind: 'answers', rev: 3, payload: {}, createdAt: T.open });
    await applyPull(db, syncResponse({ executions: [{ ...x, answersRev: 5, answers: { a: { number: 9 } } }] }), 0, NOW);
    expect(await db.first('SELECT rev, answers FROM executions')).toEqual({ rev: 3, answers: '{"a":{"number":3}}' });

    await db.run('DELETE FROM outbox');
    await db.run(`UPDATE executions SET state = 'partial', locked_at = ?`, [T.closes]);
    await applyPull(db, syncResponse({ executions: [{ ...x, answersRev: 5, answers: { a: { number: 9 } } }] }), 0, NOW);
    expect(await db.first('SELECT state, rev, synced_rev, answers FROM executions')).toEqual({ state: 'partial', rev: 5, synced_rev: 5, answers: '{"a":{"number":9}}' });
  });
});

describe('pruning old occurrences', () => {
  const OLD_NOW = Date.parse(T.closes) + 8 * 24 * 60 * 60 * 1000;
  const seed = async (db: Awaited<ReturnType<typeof openTestDb>>) => {
    await applyPull(db, syncResponse({ occurrences: [occurrence()] }), 0, NOW);
    await db.run(`INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES ('x', ?, ?, 'completed', 'accepted', ?, ?)`, [OCC, VERSION, T.open, T.open]);
    await db.run(`INSERT INTO media (id, execution_id, kind, source, mime, bytes, captured_at, local_uri, uploaded_at, file_deleted_at) VALUES ('m', 'x', 'photo', 'camera', 'image/jpeg', 1, ?, 'u', ?, ?)`, [T.open, T.open, T.open]);
    await db.run(`INSERT INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES ('r', 'x', 'i', 'errors.MEDIA_TOO_LARGE', ?)`, [T.open]);
  };
  const counts = async (db: Awaited<ReturnType<typeof openTestDb>>) => ({
    occ: (await db.first<{ n: number }>('SELECT count(*) AS n FROM occurrences'))!.n,
    exe: (await db.first<{ n: number }>('SELECT count(*) AS n FROM executions'))!.n,
    med: (await db.first<{ n: number }>('SELECT count(*) AS n FROM media'))!.n,
    ref: (await db.first<{ n: number }>('SELECT count(*) AS n FROM media_refusals'))!.n,
  });

  it('prunes a fully synced occurrence, its execution and media once its window closed over 7 days ago', async () => {
    const db = await openTestDb();
    await seed(db);
    await applyPull(db, syncResponse({ occurrences: [] }), 0, NOW + 6 * 24 * 60 * 60 * 1000);
    expect(await counts(db)).toEqual({ occ: 1, exe: 1, med: 1, ref: 1 });
    await applyPull(db, syncResponse({ occurrences: [] }), 0, OLD_NOW);
    expect(await counts(db)).toEqual({ occ: 0, exe: 0, med: 0, ref: 0 });
  });

  it('keeps an old occurrence that still has an unsynced command, media or answers', async () => {
    const db = await openTestDb();
    await seed(db);
    await appendCommand(db, { executionId: 'x', kind: 'complete', rev: 1, payload: {}, createdAt: T.open });
    await applyPull(db, syncResponse({ occurrences: [] }), 0, OLD_NOW);
    expect(await counts(db)).toEqual({ occ: 1, exe: 1, med: 1, ref: 1 });
    await db.run('DELETE FROM outbox');
    await db.run(`UPDATE media SET uploaded_at = NULL`);
    await applyPull(db, syncResponse({ occurrences: [] }), 0, OLD_NOW);
    expect((await counts(db)).occ).toBe(1);
    await db.run(`UPDATE media SET uploaded_at = '${T.open}'`);
    await db.run('UPDATE executions SET rev = 2, synced_rev = 1');
    await applyPull(db, syncResponse({ occurrences: [] }), 0, OLD_NOW);
    expect((await counts(db)).occ).toBe(1);
  });

  it('keeps occurrences the server still returns and ones whose window closed recently', async () => {
    const db = await openTestDb();
    await seed(db);
    await applyPull(db, syncResponse({ occurrences: [occurrence()] }), 0, OLD_NOW);
    expect((await counts(db)).occ).toBe(1);
  });

  it('stores every version it receives, including ones for executions only', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, syncResponse({ occurrences: [], checklistVersions: [versionOf(c.content, VERSION2)], executions: [myExecution({ checklistVersionId: VERSION2 })] }), 0, NOW);
    expect(await knownVersionIds(db)).toEqual([VERSION2]);
  });
});

import { TASK_LIMITS } from '@taskop/contracts';
import { getMeta } from './db';
import { appendCommand } from './outbox';
import { applyPull, knownVersionIds } from './sync-pull';
import { knownTaskIds } from './task-records';
import { type ExecutionRow, toExecution } from './local-model';
import {
  checklist,
  completedAnswers,
  myExecution,
  OCC,
  OCC2,
  occurrence,
  OTHER,
  OTHER_EXECUTION,
  REWORK_EXECUTION,
  reworkRequest,
  reworkSync,
  syncResponse,
  syncTask,
  T,
  TASK,
  TASK2,
  TEAM,
  VERSION,
  VERSION2,
  versionOf,
} from './testing/fixtures';
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
    await appendCommand(db, { entityType: 'execution', entityId: x.id, kind: 'answers', rev: 3, payload: {}, createdAt: T.open });
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
    await db.run(`INSERT INTO media (id, owner_type, owner_id, kind, source, mime, bytes, captured_at, local_uri, uploaded_at, file_deleted_at) VALUES ('m', 'execution', 'x', 'photo', 'camera', 'image/jpeg', 1, ?, 'u', ?, ?)`, [T.open, T.open, T.open]);
    await db.run(`INSERT INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES ('r', 'execution', 'x', 'i', 'errors.MEDIA_TOO_LARGE', ?)`, [T.open]);
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
    await appendCommand(db, { entityType: 'execution', entityId: 'x', kind: 'complete', rev: 1, payload: {}, createdAt: T.open });
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

describe('tasks in /me/sync', () => {
  const taskRows = (db: Awaited<ReturnType<typeof openTestDb>>) =>
    db.all<{ id: string; local_status: string; rev: number; title: string }>(`SELECT id, local_status, rev, json_extract(data, '$.title') AS title FROM tasks ORDER BY id`);
  /** A status command waiting in the outbox, as the task store (Task 6) queues it. */
  const queueStatus = (db: Awaited<ReturnType<typeof openTestDb>>, taskId: string, kind = 'task.start') =>
    db.run(`INSERT INTO outbox (entity_type, entity_id, kind, payload, created_at) VALUES ('task', ?, ?, '{}', ?)`, [taskId, kind, T.open]);

  it('stores the tasks it is given and reports them as known', async () => {
    const db = await openTestDb();
    const team = syncTask({ id: TASK2, title: 'Rəfləri yığ', assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    await applyPull(db, syncResponse({ tasks: [syncTask(), team] }), 0, NOW);
    expect(await taskRows(db)).toEqual([
      { id: TASK, local_status: 'new', rev: 1, title: 'Soyuducunun qapısını təmir et' },
      { id: TASK2, local_status: 'new', rev: 1, title: 'Rəfləri yığ' },
    ]);
    expect(JSON.parse((await db.first<{ data: string }>('SELECT data FROM tasks WHERE id = ?', [TASK]))!.data)).toEqual(syncTask());
    expect((await knownTaskIds(db)).sort()).toEqual([TASK, TASK2]);
  });

  it("reports the 100 tasks the server updated last as known, whatever the order the phone received them in", async () => {
    const db = await openTestDb();
    for (let i = 0; i < 101; i++) {
      const id = `task-${String(i).padStart(3, '0')}`;
      const serverUpdatedAt = new Date(Date.parse(T.open) + i * 60_000).toISOString();
      // The phone's own updated_at runs the other way round (mergeTask rewrites it on every pull): it must not decide.
      const localUpdatedAt = new Date(Date.parse(T.open) + (200 - i) * 60_000).toISOString();
      await db.run(`INSERT INTO tasks (id, data, local_status, rev, received_at, updated_at) VALUES (?, ?, 'new', 1, ?, ?)`, [
        id, JSON.stringify({ updatedAt: serverUpdatedAt }), T.open, localUpdatedAt,
      ]);
    }
    const known = await knownTaskIds(db);
    expect(known).toHaveLength(TASK_LIMITS.knownTaskIds);
    expect(known).not.toContain('task-000');
    expect(known[0]).toBe('task-100');
    expect(known[99]).toBe('task-001');
  });

  it('a pull never overrides the status of a queued accept, start or submission, nor touches the draft', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ tasks: [syncTask()] }), 0, NOW);
    await db.run(`UPDATE tasks SET local_status = 'in_progress'`);
    await db.run(`INSERT INTO task_drafts (task_id, submission_id, text, media_ids, updated_at) VALUES (?, 's1', 'Rezin dəyişildi', '[]', ?)`, [TASK, T.open]);
    await queueStatus(db, TASK);
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 2, title: 'Qapını təmir et' })] }), 0, NOW);
    expect(await taskRows(db)).toEqual([{ id: TASK, local_status: 'in_progress', rev: 2, title: 'Qapını təmir et' }]);
    expect(await db.first('SELECT text FROM task_drafts')).toEqual({ text: 'Rezin dəyişildi' });

    // A queued media registration does not hold the status: only accept, start and submit do.
    await db.run('DELETE FROM outbox');
    await db.run(`INSERT INTO outbox (entity_type, entity_id, kind, ref_id, payload, created_at) VALUES ('task', ?, 'task.media', 'm', '{}', ?)`, [TASK, T.open]);
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 3, status: 'cancelled', cancelReason: 'Lazım deyil' })] }), 0, NOW);
    expect((await taskRows(db))[0]).toMatchObject({ local_status: 'cancelled', rev: 3 });
    expect(await db.first('SELECT text FROM task_drafts')).toEqual({ text: 'Rezin dəyişildi' });
  });

  it('ignores a server copy older than the one it holds', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 3, status: 'accepted' })] }), 0, NOW);
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 2, status: 'new', title: 'Köhnə' })] }), 0, NOW);
    expect(await taskRows(db)).toEqual([{ id: TASK, local_status: 'accepted', rev: 3, title: 'Soyuducunun qapısını təmir et' }]);
  });

  it('drops tasks in removedTaskIds with their draft and files, unless work for them is still queued or uploading', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ tasks: [syncTask(), syncTask({ id: TASK2 })] }), 0, NOW);
    for (const id of [TASK, TASK2]) {
      await db.run(
        `INSERT INTO media (id, owner_type, owner_id, role, kind, source, mime, bytes, captured_at, local_uri, registered_at, uploaded_at)
         VALUES (?, 'task', ?, 'response', 'photo', 'camera', 'image/jpeg', 1, ?, ?, ?, ?)`,
        [`m-${id}`, id, T.open, `file:///doc/media/${id}.jpg`, T.open, T.open],
      );
      await db.run('INSERT INTO task_drafts (task_id, submission_id, updated_at) VALUES (?, ?, ?)', [id, `s-${id}`, T.open]);
      await db.run(`INSERT INTO media_refusals (media_id, owner_type, owner_id, error_key, created_at) VALUES (?, 'task', ?, 'errors.MEDIA_TOO_LARGE', ?)`, [`r-${id}`, id, T.open]);
    }
    await queueStatus(db, TASK2, 'task.submit');
    expect(await applyPull(db, syncResponse({ tasks: [], removedTaskIds: [TASK, TASK2] }), 0, NOW)).toEqual([`file:///doc/media/${TASK}.jpg`]);
    expect(await db.all('SELECT id FROM tasks')).toEqual([{ id: TASK2 }]);
    expect(await db.all('SELECT task_id FROM task_drafts')).toEqual([{ task_id: TASK2 }]);
    expect(await db.all('SELECT owner_id FROM media')).toEqual([{ owner_id: TASK2 }]);
    expect(await db.all('SELECT owner_id FROM media_refusals')).toEqual([{ owner_id: TASK2 }]);

    // The submission went through, but its photo is still uploading: the task waits for the upload.
    await db.run('DELETE FROM outbox');
    await db.run('UPDATE media SET uploaded_at = NULL');
    expect(await applyPull(db, syncResponse({ tasks: [], removedTaskIds: [TASK2] }), 0, NOW)).toEqual([]);
    await db.run('UPDATE media SET uploaded_at = ?', [T.open]);
    expect(await applyPull(db, syncResponse({ tasks: [], removedTaskIds: [TASK2] }), 0, NOW)).toEqual([`file:///doc/media/${TASK2}.jpg`]);
    expect(await db.all('SELECT id FROM tasks')).toEqual([]);
  });
});

describe('rework runs (sub-project 8)', () => {
  const flagged = (c: ReturnType<typeof checklist>) => [{ itemId: c.temp.id, comment: 'Temperaturu yenidən ölçün' }];
  const stored = async (db: Awaited<ReturnType<typeof openTestDb>>) => toExecution((await db.first<ExecutionRow>('SELECT * FROM executions'))!);

  it('stores a run sent back for correction with its round and open request', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    expect(await stored(db)).toMatchObject({
      id: REWORK_EXECUTION, state: 'rework', reworkRound: 1, rework: reworkRequest({ items: flagged(c), answersBefore: completedAnswers(c) }),
      answers: completedAnswers(c), rev: 3, syncedRev: 3, completedAt: T.due,
    });
    expect(await db.first('SELECT status FROM occurrences')).toEqual({ status: 'correction_required' });
  });

  it('turns a completed copy into rework when the run is sent back, clearing its old note and finished mark', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c), { execution: { state: 'completed', reworkRound: 0, rework: null } }), 0, NOW);
    await db.run(`UPDATE executions SET finished_synced_at = ?, sync_note = 'errors.EXECUTION_NOT_ACTIVE'`, [T.due]);
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    expect(await db.first('SELECT state, rework_round, finished_synced_at, sync_note FROM executions')).toEqual({
      state: 'rework', rework_round: 1, finished_synced_at: null, sync_note: null,
    });
  });

  it('drops the request when the server lists the run as completed again', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    await applyPull(db, reworkSync(c, flagged(c), { execution: { state: 'completed', rework: null } }), 0, NOW);
    expect(await stored(db)).toMatchObject({ state: 'completed', reworkRound: 1, rework: null });
  });

  it('a rework run the server stopped listing goes back to completed when nothing of it is queued', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    await applyPull(db, syncResponse({ occurrences: [], executions: [] }), 0, NOW);
    expect(await stored(db)).toMatchObject({ state: 'completed', rework: null, answers: completedAnswers(c) });
    // The occurrence stays (it has an execution) and is no longer offered for correction.
    expect(await db.first('SELECT id, status FROM occurrences')).toEqual({ id: OCC, status: 'completed' });
  });

  it('keeps a rework run whose work is still queued, whatever the server lists', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    await appendCommand(db, { entityType: 'execution', entityId: REWORK_EXECUTION, kind: 'answers', rev: 4, payload: { rev: 4, answers: {} }, createdAt: T.open });
    await applyPull(db, syncResponse({ occurrences: [], executions: [] }), 0, NOW);
    expect(await stored(db)).toMatchObject({ state: 'rework', rework: { round: 1 } });
    expect(await db.first('SELECT status FROM occurrences')).toEqual({ status: 'correction_required' });
  });
});

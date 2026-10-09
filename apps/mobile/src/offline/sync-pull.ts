import type { MyExecution, SyncResponse } from '@taskop/contracts';
import { type Db, setMeta } from './db';
import { type ExecutionRow, iso, normIso } from './local-model';

const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Occurrences the server no longer returns whose window closed over 7 days ago are dropped with their finished executions and media rows,
 * unless the phone still holds unsynced work for them: a queued or failed command, an answers revision not yet acknowledged,
 * a claim not yet accepted, or media that is not uploaded or whose file is still on the phone (the media queue deletes files first).
 */
async function pruneOld(tx: Db, returnedIds: string[], now: number): Promise<void> {
  const params = [JSON.stringify(returnedIds), iso(now - PRUNE_AFTER_MS)];
  const prunable = `
    SELECT o.id FROM occurrences o
    WHERE o.id NOT IN (SELECT value FROM json_each(?))
      AND o.closes_at < ?
      AND NOT EXISTS (
        SELECT 1 FROM executions e
        WHERE e.occurrence_id = o.id
          AND (e.rev > e.synced_rev OR e.claim = 'pending'
            OR EXISTS (SELECT 1 FROM outbox x WHERE x.execution_id = e.id)
            OR EXISTS (SELECT 1 FROM media m WHERE m.execution_id = e.id AND (m.uploaded_at IS NULL OR m.file_deleted_at IS NULL))))`;
  await tx.run(`DELETE FROM media WHERE execution_id IN (SELECT id FROM executions WHERE occurrence_id IN (${prunable}))`, params);
  await tx.run(`DELETE FROM media_refusals WHERE execution_id IN (SELECT id FROM executions WHERE occurrence_id IN (${prunable}))`, params);
  await tx.run(`DELETE FROM executions WHERE occurrence_id IN (${prunable})`, params);
  await tx.run(`DELETE FROM occurrences WHERE id IN (${prunable})`, params);
}

/** Spec §6.1, applied in one transaction. Occurrences missing from the response were cancelled or reassigned (Part 1 #14). */
export async function applyPull(db: Db, res: SyncResponse, offsetMs: number, now: number): Promise<void> {
  await db.transaction(async (tx) => {
    await setMeta(tx, 'clockOffsetMs', String(offsetMs));
    await setMeta(tx, 'lastSyncedAt', iso(now));
    for (const v of res.checklistVersions) {
      // Versions never change once published, so a known ID is kept as it is.
      await tx.run(
        'INSERT INTO checklist_versions (id, checklist_id, number, schema_version, content, received_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        [v.id, v.checklistId, v.number, v.schemaVersion, JSON.stringify(v.content), iso(now)],
      );
    }
    for (const o of res.occurrences) {
      await tx.run(
        `INSERT INTO occurrences (id, checklist_id, checklist_name, site_id, site_name, shift_name, local_date, starts_at, due_at, closes_at, status,
           checklist_version_id, claim_execution_id, claim_user_id, claim_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           checklist_name = excluded.checklist_name, site_name = excluded.site_name, shift_name = excluded.shift_name,
           local_date = excluded.local_date, starts_at = excluded.starts_at, due_at = excluded.due_at, closes_at = excluded.closes_at,
           status = excluded.status, checklist_version_id = excluded.checklist_version_id,
           claim_execution_id = excluded.claim_execution_id, claim_user_id = excluded.claim_user_id, claim_name = excluded.claim_name`,
        [
          o.id, o.checklistId, o.checklistName, o.siteId, o.siteName, o.shiftName, o.localDate,
          normIso(o.startsAt), normIso(o.dueAt), normIso(o.closesAt), o.status, o.checklistVersionId,
          o.claim?.executionId ?? null, o.claim?.executorUserId ?? null, o.claim?.executorName ?? null,
        ],
      );
    }
    await pruneOld(tx, res.occurrences.map((o) => o.id), now);
    await tx.run(
      `DELETE FROM occurrences
       WHERE id NOT IN (SELECT value FROM json_each(?))
         AND id NOT IN (SELECT occurrence_id FROM executions)`,
      [JSON.stringify(res.occurrences.map((o) => o.id))],
    );
    for (const x of res.executions) await mergeExecution(tx, x, now);
  });
}

async function mergeExecution(tx: Db, x: MyExecution, now: number): Promise<void> {
  const claim = x.state === 'rejected' ? 'rejected' : 'accepted';
  const local = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [x.id]);
  if (!local) {
    await tx.run(
      `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, rejected_reason, started_at, completed_at, answers, rev, synced_rev, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [x.id, x.occurrenceId, x.checklistVersionId, x.state, claim, x.rejectedReason, normIso(x.startedAt), x.completedAt ? normIso(x.completedAt) : null,
        JSON.stringify(x.answers), x.answersRev, x.answersRev, iso(now)],
    );
    return;
  }
  const queued = (await tx.first<{ n: number }>('SELECT count(*) AS n FROM outbox WHERE execution_id = ?', [x.id]))?.n ?? 0;
  if (queued > 0) return; // Local changes not sent yet win; the next pull sees their result.
  // The local lock at closes_at is sticky even before the server's sweep has run (decision 15).
  const state = local.state === 'partial' && x.state === 'active' ? 'partial' : x.state;
  // After a refusal was resolved (sync_note), local revisions the server never took are gone for good: the server's copy wins.
  const takeAnswers = x.answersRev > local.rev || local.sync_note !== null;
  await tx.run(
    `UPDATE executions SET state = ?, claim = ?, rejected_reason = ?, completed_at = ?, answers = ?, rev = ?, synced_rev = ?, updated_at = ?
     WHERE id = ?`,
    [state, claim, x.rejectedReason, x.completedAt ? normIso(x.completedAt) : local.completed_at,
      takeAnswers ? JSON.stringify(x.answers) : local.answers, takeAnswers ? x.answersRev : local.rev,
      takeAnswers ? x.answersRev : Math.max(local.synced_rev, x.answersRev), iso(now), x.id],
  );
}

/** The versions the phone already holds, so /me/sync sends only new content (≤ 200, Part 1 `syncQuerySchema`). */
export async function knownVersionIds(db: Db): Promise<string[]> {
  return (await db.all<{ id: string }>('SELECT id FROM checklist_versions ORDER BY received_at DESC, id LIMIT 200')).map((r) => r.id);
}

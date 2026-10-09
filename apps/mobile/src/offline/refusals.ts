import type { Answers } from '@taskop/contracts';
import type { Db } from './db';
import { withoutMedia } from './execution-store';
import { type ExecutionRow, iso, toExecution } from './local-model';
import { appendCommand, type OutboxCommand } from './outbox';

/**
 * What happens to work the server refused for good. Such a command could only stay red forever and keep the
 * execution's local state frozen (a queued command blocks the pull's merge), so it is resolved instead: the command
 * (and what depends on it) is removed in one transaction, a short note says why ("Server qəbul etmədi: …"), and the
 * next pull takes the server's copy of the execution. Every function runs inside the caller's transaction and returns
 * the local files to delete once it commits.
 */

const refersTo = (answers: Answers, mediaId: string): boolean =>
  Object.values(answers).some((a) => a?.photos?.includes(mediaId) || a?.videos?.includes(mediaId) || a?.problem?.mediaIds.includes(mediaId));

/** The item whose answer names the medium (a problem-only medium has no item of its own). */
const itemReferring = (answers: Answers, mediaId: string): string | null =>
  Object.entries(answers).find(([, a]) => a && refersTo({ x: a }, mediaId))?.[0] ?? null;

const queuedRevisions = (tx: Db, executionId: string) =>
  tx.all<{ seq: number; payload: string }>(`SELECT seq, payload FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')`, [executionId]);

/** Gives every queued answers/complete command of an execution a new revision (payload and column alike). Returns how many. */
export async function requeueRevision(tx: Db, executionId: string, rev: number, answers: Answers | null): Promise<number> {
  const queued = await queuedRevisions(tx, executionId);
  for (const q of queued) {
    const payload = { ...(JSON.parse(q.payload) as Record<string, unknown>), rev, ...(answers ? { answers } : {}) };
    await tx.run('UPDATE outbox SET rev = ?, payload = ? WHERE seq = ?', [rev, JSON.stringify(payload), q.seq]);
  }
  return queued.length;
}

/**
 * A medium the server refused for good (MEDIA_TOO_LARGE, EVIDENCE_LIVE_ONLY, a file missing from the phone, …), or one
 * the worker discarded. Its row, its queued registration and its file go; with `errorKey` its item shows why
 * ("Server bu faylı qəbul etmədi: …") until the worker attaches a new medium there.
 *
 * It is dropped from the answers under a new revision, so the answers and completion still queued do not fail on an
 * unknown medium; the item's evidence requirement shows as missing again, the worker's signal to retake it. Queued
 * commands are rewritten in place, keeping their action time (an answer made before closes_at stays before it) and
 * their order before a completion. Only an execution still open gets a new answers command when none is queued; a
 * finished one only forgets the medium locally (the server keeps its copy, nothing could change it).
 */
export async function dropMedium(tx: Db, mediaId: string, now: number, errorKey: string | null): Promise<string | null> {
  await tx.run(`DELETE FROM outbox WHERE kind = 'media' AND ref_id = ?`, [mediaId]);
  // The worker may have removed the medium meanwhile: removeMedia already dropped it from the answers.
  const medium = await tx.first<{ local_uri: string; execution_id: string; item_id: string | null; file_deleted_at: string | null }>(
    'SELECT local_uri, execution_id, item_id, file_deleted_at FROM media WHERE id = ?',
    [mediaId],
  );
  if (!medium) return null;
  await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
  const file = medium.file_deleted_at === null ? medium.local_uri : null;
  const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [medium.execution_id]);
  if (!row) return file;
  const e = toExecution(row);
  if (errorKey) {
    await tx.run('INSERT OR REPLACE INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES (?, ?, ?, ?, ?)', [
      mediaId, e.id, medium.item_id ?? itemReferring(e.answers, mediaId), errorKey, iso(now),
    ]);
  }
  if (!refersTo(e.answers, mediaId)) return file;
  const answers = withoutMedia(e.answers, mediaId);
  if ((await queuedRevisions(tx, e.id)).length === 0 && e.state !== 'active') {
    await tx.run('UPDATE executions SET answers = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), iso(now), e.id]);
    return file;
  }
  const rev = e.rev + 1;
  await tx.run('UPDATE executions SET answers = ?, rev = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), rev, iso(now), e.id]);
  if ((await requeueRevision(tx, e.id, rev, answers)) === 0) {
    await appendCommand(tx, { executionId: e.id, kind: 'answers', rev, payload: { rev, answers }, createdAt: iso(now) });
  }
  return file;
}

/**
 * The server will never hold this execution (its claim was refused for good, or the worker discarded the claim): every
 * queued command and every medium of it goes, and it stays on the phone read-only with the note.
 */
async function abandonExecution(tx: Db, executionId: string, now: number, note: string): Promise<string[]> {
  await tx.run('DELETE FROM outbox WHERE execution_id = ?', [executionId]);
  const media = await tx.all<{ local_uri: string; file_deleted_at: string | null }>('SELECT local_uri, file_deleted_at FROM media WHERE execution_id = ?', [executionId]);
  await tx.run('DELETE FROM media WHERE execution_id = ?', [executionId]);
  await tx.run(
    `UPDATE executions SET state = 'rejected', claim = 'rejected', synced_rev = rev, sync_note = ?, updated_at = ? WHERE id = ?`,
    [note, iso(now), executionId],
  );
  return media.filter((m) => m.file_deleted_at === null).map((m) => m.local_uri);
}

/**
 * The server no longer takes answers or a completion for this execution (closed, or completed elsewhere): the queued
 * ones go, it locks locally as partial (a local completion the server never accepted included), and the next pull
 * brings the server's state and answers.
 */
async function closeExecution(tx: Db, executionId: string, now: number, note: string): Promise<void> {
  await tx.run(`DELETE FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')`, [executionId]);
  await tx.run(
    `UPDATE executions SET
       state = CASE WHEN state IN ('active', 'completed') THEN 'partial' ELSE state END,
       completed_at = CASE WHEN state = 'completed' THEN NULL ELSE completed_at END,
       locked_at = coalesce(locked_at, ?), synced_rev = rev, sync_note = ?, updated_at = ?
     WHERE id = ?`,
    [iso(now), note, iso(now), executionId],
  );
}

/**
 * A completion refused for unmet requirements (e.g. a refused medium left an item without evidence) reopens the
 * execution while its window is still open, so the worker can fix it and complete again; the refused command goes
 * (the next completion queues a fresh one). Returns whether it reopened.
 */
export async function reopenRefusedCompletion(tx: Db, cmd: OutboxCommand, now: number, note: string | null = null): Promise<boolean> {
  const reopened = await tx.run(
    `UPDATE executions SET state = 'active', completed_at = NULL, finished_synced_at = NULL, sync_note = coalesce(?, sync_note), updated_at = ?
     WHERE id = ? AND state = 'completed'
       AND EXISTS (SELECT 1 FROM occurrences o WHERE o.id = executions.occurrence_id AND o.closes_at > ?)`,
    [note, iso(now), cmd.executionId, iso(now)],
  );
  if (reopened > 0) await tx.run('DELETE FROM outbox WHERE seq = ?', [cmd.seq]);
  return reopened > 0;
}

/**
 * Refusals no retry can ever fix are resolved instead of parked (spec §7.2 as amended by the final review):
 * a claim the server cannot find or that is not mine, answers or a completion for an execution no longer active, and
 * a completion with unmet requirements after closes_at (before it, the caller reopens the execution instead).
 * Returns the files to delete, or null when the refusal is not terminal and the command is parked as failed.
 */
export async function resolveTerminalRefusal(tx: Db, cmd: OutboxCommand, code: string, messageKey: string, now: number): Promise<string[] | null> {
  if (cmd.kind === 'claim' && (code === 'NOT_FOUND' || code === 'NOT_EXECUTOR')) return abandonExecution(tx, cmd.executionId, now, messageKey);
  if ((cmd.kind === 'answers' || cmd.kind === 'complete') && code === 'EXECUTION_NOT_ACTIVE') {
    await closeExecution(tx, cmd.executionId, now, messageKey);
    return [];
  }
  if (cmd.kind === 'complete' && code === 'REQUIREMENTS_UNMET') {
    await closeExecution(tx, cmd.executionId, now, messageKey);
    return [];
  }
  return null;
}

/**
 * "Sil" on a failed command the worker gives up on: it goes with what cannot succeed without it, and the execution
 * keeps a note of why it failed. A claim takes its execution's queued work with it; a completion reopens the
 * execution while its window is open (else it locks as partial); answers leave the execution open, and the next pull
 * brings the server's answers. Only failed commands can be discarded (never one about to be sent).
 */
export async function discardFailedCommand(tx: Db, seq: number, now: number): Promise<string[]> {
  const row = await tx.first<{ execution_id: string; kind: OutboxCommand['kind']; ref_id: string | null; error_key: string | null }>(
    `SELECT execution_id, kind, ref_id, error_key FROM outbox WHERE seq = ? AND status = 'failed'`,
    [seq],
  );
  if (!row) return [];
  const note = row.error_key ?? 'errors.INTERNAL';
  switch (row.kind) {
    case 'claim':
      return abandonExecution(tx, row.execution_id, now, note);
    case 'media': {
      await tx.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      const file = row.ref_id ? await dropMedium(tx, row.ref_id, now, note) : null;
      return file ? [file] : [];
    }
    case 'answers':
      await tx.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      await tx.run('UPDATE executions SET synced_rev = rev, sync_note = ?, updated_at = ? WHERE id = ?', [note, iso(now), row.execution_id]);
      return [];
    case 'complete': {
      const cmd = { seq, executionId: row.execution_id } as OutboxCommand;
      if (!(await reopenRefusedCompletion(tx, cmd, now, note))) await closeExecution(tx, row.execution_id, now, note);
      await tx.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      await tx.run('UPDATE executions SET synced_rev = rev WHERE id = ?', [row.execution_id]);
      return [];
    }
  }
}

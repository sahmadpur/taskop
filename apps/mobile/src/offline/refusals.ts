import type { Answers } from '@taskop/contracts';
import type { Db } from './db';
import { withoutMedia } from './execution-store';
import { type ExecutionRow, iso, toExecution } from './local-model';
import { ackCommand, appendCommand, failCommand, type OutboxCommand } from './outbox';
import { dropTaskMedium, forgetTask, revertTask, type TaskRemoved } from './task-records';

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
  tx.all<{ seq: number; payload: string }>(`SELECT seq, payload FROM outbox WHERE entity_type = 'execution' AND entity_id = ? AND kind IN ('answers', 'complete')`, [executionId]);

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
  await tx.run(`DELETE FROM outbox WHERE kind IN ('media', 'task.media') AND ref_id = ?`, [mediaId]);
  // The worker may have removed the medium meanwhile: removeMedia already dropped it from the answers.
  const medium = await tx.first<{ local_uri: string; owner_type: string; owner_id: string; item_id: string | null; file_deleted_at: string | null }>(
    'SELECT local_uri, owner_type, owner_id, item_id, file_deleted_at FROM media WHERE id = ?',
    [mediaId],
  );
  if (!medium) return null;
  await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
  const file = medium.file_deleted_at === null ? medium.local_uri : null;
  if (medium.owner_type === 'task') {
    await dropTaskMedium(tx, medium.owner_id, mediaId, now, errorKey);
    return file;
  }
  if (medium.owner_type !== 'execution') return file;
  const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [medium.owner_id]);
  if (!row) return file;
  const e = toExecution(row);
  if (errorKey) {
    await tx.run(`INSERT OR REPLACE INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES (?, 'execution', ?, ?, ?, ?)`, [
      mediaId, e.id, medium.item_id ?? itemReferring(e.answers, mediaId), errorKey, iso(now),
    ]);
  }
  if (!refersTo(e.answers, mediaId)) return file;
  const answers = withoutMedia(e.answers, mediaId);
  // A run in rework is still open: the dropped medium leaves the server's answers through a new revision.
  if ((await queuedRevisions(tx, e.id)).length === 0 && e.state !== 'active' && e.state !== 'rework') {
    await tx.run('UPDATE executions SET answers = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), iso(now), e.id]);
    return file;
  }
  const rev = e.rev + 1;
  await tx.run('UPDATE executions SET answers = ?, rev = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), rev, iso(now), e.id]);
  if ((await requeueRevision(tx, e.id, rev, answers)) === 0) {
    await appendCommand(tx, { entityType: 'execution', entityId: e.id, kind: 'answers', rev, payload: { rev, answers }, createdAt: iso(now) });
  }
  return file;
}

/**
 * The server will never hold this execution (its claim was refused for good, or the worker discarded the claim): every
 * queued command and every medium of it goes, and it stays on the phone read-only with the note.
 */
async function abandonExecution(tx: Db, executionId: string, now: number, note: string): Promise<string[]> {
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'execution' AND entity_id = ?`, [executionId]);
  const media = await tx.all<{ local_uri: string; file_deleted_at: string | null }>(`SELECT local_uri, file_deleted_at FROM media WHERE owner_type = 'execution' AND owner_id = ?`, [executionId]);
  await tx.run(`DELETE FROM media WHERE owner_type = 'execution' AND owner_id = ?`, [executionId]);
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
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'execution' AND entity_id = ? AND kind IN ('answers', 'complete')`, [executionId]);
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
    [note, iso(now), cmd.entityId, iso(now)],
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
  if (cmd.kind === 'claim' && (code === 'NOT_FOUND' || code === 'NOT_EXECUTOR')) return abandonExecution(tx, cmd.entityId, now, messageKey);
  if ((cmd.kind === 'answers' || cmd.kind === 'complete') && code === 'EXECUTION_NOT_ACTIVE') {
    await closeExecution(tx, cmd.entityId, now, messageKey);
    return [];
  }
  if (cmd.kind === 'complete' && code === 'REQUIREMENTS_UNMET') {
    await closeExecution(tx, cmd.entityId, now, messageKey);
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
  const row = await tx.first<{ entity_id: string; kind: OutboxCommand['kind']; ref_id: string | null; error_key: string | null }>(
    `SELECT entity_id, kind, ref_id, error_key FROM outbox WHERE seq = ? AND status = 'failed'`,
    [seq],
  );
  if (!row) return [];
  const note = row.error_key ?? 'errors.INTERNAL';
  switch (row.kind) {
    case 'claim':
      return abandonExecution(tx, row.entity_id, now, note);
    case 'media':
    case 'task.media': {
      await tx.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      const file = row.ref_id ? await dropMedium(tx, row.ref_id, now, note) : null;
      return file ? [file] : [];
    }
    case 'answers':
      await tx.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      await tx.run('UPDATE executions SET synced_rev = rev, sync_note = ?, updated_at = ? WHERE id = ?', [note, iso(now), row.entity_id]);
      return [];
    case 'complete': {
      const cmd = { seq, entityType: 'execution', entityId: row.entity_id } as OutboxCommand;
      if (!(await reopenRefusedCompletion(tx, cmd, now, note))) await closeExecution(tx, row.entity_id, now, note);
      await tx.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      await tx.run('UPDATE executions SET synced_rev = rev WHERE id = ?', [row.entity_id]);
      return [];
    }
    case 'task.accept':
    case 'task.start':
    case 'task.submit':
      // The failed command goes with every queued status change of its task; the draft stays, unsubmitted.
      await revertTask(tx, row.entity_id, note, now);
      return [];
  }
}

/** SP4's permanent-refusal path for an execution command: resolved when no retry can fix it, otherwise parked as failed. Returns files to delete. */
export async function resolveExecutionRefusal(tx: Db, cmd: OutboxCommand, code: string, messageKey: string, now: number): Promise<string[]> {
  if (cmd.kind === 'media') {
    await ackCommand(tx, cmd.seq);
    const uri = cmd.refId ? await dropMedium(tx, cmd.refId, now, messageKey) : null;
    return uri ? [uri] : [];
  }
  if (cmd.kind === 'complete' && code === 'REQUIREMENTS_UNMET' && (await reopenRefusedCompletion(tx, cmd, now))) return [];
  const resolved = await resolveTerminalRefusal(tx, cmd, code, messageKey, now);
  if (resolved) return resolved;
  await failCommand(tx, cmd.seq, code, messageKey);
  return [];
}

/** Refusals of a status command that the task shows instead of a red row (decision 7). */
const SHOWN_ON_TASK: ReadonlySet<string> = new Set(['EVIDENCE_REQUIRED', 'EVIDENCE_LIVE_ONLY', 'VALIDATION_FAILED', 'MEDIA_LIMIT_REACHED']);

/**
 * Spec §7.1 and Part 1 "Refusals": a task a teammate took, or one the worker can no longer read (404, 403, reassigned
 * away), goes with everything the phone holds for it; a refused medium is dropped from the draft and the queued
 * submission; a state change or an evidence refusal reverts the task to the server's copy, keeping the draft, with the
 * note. Anything else is parked as failed. Returns the files to delete and the removed task to tell the worker about
 * (none when the phone held no such task, e.g. a manager's instruction photo).
 */
export async function resolveTaskRefusal(
  tx: Db,
  cmd: OutboxCommand,
  code: string,
  messageKey: string,
  now: number,
): Promise<{ files: string[]; removed: TaskRemoved | null }> {
  if (code === 'TASK_ALREADY_TAKEN' || code === 'NOT_FOUND' || code === 'FORBIDDEN') {
    const gone = await forgetTask(tx, cmd.entityId);
    return { files: gone.files, removed: gone.title === null ? null : { taskId: cmd.entityId, title: gone.title } };
  }
  if (code === 'TASK_STATE_INVALID') {
    // The response photos in the draft stay (the read-only draft still shows them; a later submission registers them again),
    // but no registration can succeed now. Every other medium of the task (instruction photos, a task the phone does not hold) has no home and goes,
    // except a registered file still uploading: it belongs to an earlier accepted submission, and the server still takes its upload.
    await tx.run(`DELETE FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind = 'task.media'`, [cmd.entityId]);
    const orphans = await tx.all<{ id: string; local_uri: string; file_deleted_at: string | null }>(
      `SELECT id, local_uri, file_deleted_at FROM media
       WHERE owner_type = 'task' AND owner_id = ?
         AND (registered_at IS NULL OR uploaded_at IS NOT NULL)
         AND id NOT IN (SELECT value FROM json_each(coalesce((SELECT media_ids FROM task_drafts WHERE task_id = ?), '[]')))`,
      [cmd.entityId, cmd.entityId],
    );
    for (const m of orphans) await tx.run('DELETE FROM media WHERE id = ?', [m.id]);
    await revertTask(tx, cmd.entityId, messageKey, now);
    return { files: orphans.filter((m) => m.file_deleted_at === null).map((m) => m.local_uri), removed: null };
  }
  if (cmd.kind === 'task.media' && code === 'CLOCK_INVALID') {
    // A clock offset problem, not a refusal of the photo: parked like a status command, so the next pull refreshes the offset and "Yenidən cəhd et" registers it.
    await failCommand(tx, cmd.seq, code, messageKey);
    return { files: [], removed: null };
  }
  if (cmd.kind === 'task.media') {
    await ackCommand(tx, cmd.seq);
    const uri = cmd.refId ? await dropMedium(tx, cmd.refId, now, messageKey) : null;
    return { files: uri ? [uri] : [], removed: null };
  }
  if (SHOWN_ON_TASK.has(code)) await revertTask(tx, cmd.entityId, messageKey, now);
  else await failCommand(tx, cmd.seq, code, messageKey);
  return { files: [], removed: null };
}

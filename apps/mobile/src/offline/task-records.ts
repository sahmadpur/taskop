import { type SyncTask, TASK_LIMITS, type TaskMediaRegisterInput, type TaskMediaRole } from '@taskop/contracts';
import type { Db } from './db';
import { type DraftRow, iso, type LocalMedia } from './local-model';

/** Commands that move a task's status. Until the server has answered them, the phone's status wins over a pull (spec §7.1). */
export const STATUS_KINDS_SQL = `('task.accept', 'task.start', 'task.submit')`;

/**
 * Stores the server's copy of a task (from /me/sync or a command's answer). A copy older than the one held is ignored.
 * The local status follows the server's unless an accept, start or submission is still queued (other than `ignoreSeq`:
 * the command whose answer this is). The draft is never touched here.
 */
export async function mergeTask(tx: Db, task: SyncTask, now: number, ignoreSeq = -1): Promise<void> {
  const queued =
    (
      await tx.first<{ n: number }>(
        `SELECT count(*) AS n FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind IN ${STATUS_KINDS_SQL} AND seq <> ?`,
        [task.id, ignoreSeq],
      )
    )?.n ?? 0;
  await tx.run(
    `INSERT INTO tasks (id, data, local_status, rev, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, rev = excluded.rev, received_at = excluded.received_at, updated_at = excluded.updated_at,
       local_status = CASE WHEN ? > 0 THEN tasks.local_status ELSE excluded.local_status END
     WHERE excluded.rev >= tasks.rev`,
    [task.id, JSON.stringify(task), task.status, task.rev, iso(now), iso(now), queued],
  );
}

/** Deletes a task with everything the phone holds for it. Returns its title and the local files to delete once the transaction commits. */
export async function forgetTask(tx: Db, taskId: string): Promise<{ title: string | null; files: string[] }> {
  const row = await tx.first<{ data: string }>('SELECT data FROM tasks WHERE id = ?', [taskId]);
  const media = await tx.all<{ local_uri: string; file_deleted_at: string | null }>(
    `SELECT local_uri, file_deleted_at FROM media WHERE owner_type = 'task' AND owner_id = ?`,
    [taskId],
  );
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'task' AND entity_id = ?`, [taskId]);
  await tx.run(`DELETE FROM media WHERE owner_type = 'task' AND owner_id = ?`, [taskId]);
  await tx.run(`DELETE FROM media_refusals WHERE owner_type = 'task' AND owner_id = ?`, [taskId]);
  await tx.run('DELETE FROM task_drafts WHERE task_id = ?', [taskId]);
  await tx.run('DELETE FROM tasks WHERE id = ?', [taskId]);
  return {
    title: row ? (JSON.parse(row.data) as SyncTask).title : null,
    files: media.filter((m) => m.file_deleted_at === null).map((m) => m.local_uri),
  };
}

/**
 * Spec §7.1: tasks that left the user's set (reassigned away, taken by a teammate, closed over 7 days ago) go, unless a
 * command for them is still queued or one of their files is still uploading: those resolve first, and a later pull
 * removes the task. Returns the local files to delete once the transaction commits.
 */
export async function removeTasks(tx: Db, ids: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const id of ids) {
    const busy = await tx.first<{ one: number }>(
      `SELECT 1 AS one WHERE EXISTS (SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_id = ?)
          OR EXISTS (SELECT 1 FROM media WHERE owner_type = 'task' AND owner_id = ?
                       AND registered_at IS NOT NULL AND uploaded_at IS NULL AND failed_code IS NULL)`,
      [id, id],
    );
    if (!busy) files.push(...(await forgetTask(tx, id)).files);
  }
  return files;
}

/**
 * The ids of the TASK_LIMITS.knownTaskIds (100) tasks the server updated last among those the phone holds, newest first:
 * /me/sync answers which of them left the set. The server truncates a longer list, so the cap is applied here; tasks beyond
 * the 100 newest are not reported until they are among them. Ordered by the server's `updatedAt`, not the local `updated_at`
 * that `mergeTask` rewrites on every pull.
 */
export async function knownTaskIds(db: Db): Promise<string[]> {
  return (
    await db.all<{ id: string }>(`SELECT id FROM tasks ORDER BY json_extract(data, '$.updatedAt') DESC, id LIMIT ?`, [TASK_LIMITS.knownTaskIds])
  ).map((r) => r.id);
}

/**
 * The phone's view of a task goes back to the server's copy: queued accept, start and submission commands go, a submitted
 * draft becomes unsubmitted (kept; editable only while the task is in progress), and the note says why.
 */
export async function revertTask(tx: Db, taskId: string, note: string, now: number): Promise<void> {
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind IN ${STATUS_KINDS_SQL}`, [taskId]);
  await tx.run('UPDATE task_drafts SET submitted_at = NULL, updated_at = ? WHERE task_id = ?', [iso(now), taskId]);
  await tx.run(`UPDATE tasks SET local_status = json_extract(data, '$.status'), sync_note = ?, updated_at = ? WHERE id = ?`, [note, iso(now), taskId]);
}

/** The registration body of a task medium (POST /tasks/:id/media) with the device's capture time; the sender moves it onto the server's clock. */
export function taskMediaBody(
  m: Pick<LocalMedia, 'id' | 'kind' | 'source' | 'mime' | 'bytes' | 'width' | 'height' | 'durationMs' | 'capturedAt'>,
  role: TaskMediaRole,
): TaskMediaRegisterInput {
  return {
    id: m.id, role, kind: m.kind, source: m.source, mime: m.mime, bytes: m.bytes,
    width: m.width, height: m.height, durationMs: m.durationMs, capturedAt: m.capturedAt,
  };
}

/** What the engine reports when a task left the phone because the server refused its work for good (spec §7.1). */
export interface TaskRemoved {
  taskId: string;
  title: string | null;
}

/**
 * A task medium the server refused for good, or the worker discarded after it failed: it leaves the draft and any queued
 * submission (so the submission does not fail on an unknown medium), and with `errorKey` the task notes why. The caller
 * has already deleted the medium's row and its registration.
 */
export async function dropTaskMedium(tx: Db, taskId: string, mediaId: string, now: number, errorKey: string | null): Promise<void> {
  const draft = await tx.first<DraftRow>('SELECT * FROM task_drafts WHERE task_id = ?', [taskId]);
  if (draft) {
    const mediaIds = (JSON.parse(draft.media_ids) as string[]).filter((x) => x !== mediaId);
    await tx.run('UPDATE task_drafts SET media_ids = ?, updated_at = ? WHERE task_id = ?', [JSON.stringify(mediaIds), iso(now), taskId]);
  }
  const queued = await tx.all<{ seq: number; payload: string }>(
    `SELECT seq, payload FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind = 'task.submit'`,
    [taskId],
  );
  for (const q of queued) {
    const payload = JSON.parse(q.payload) as { mediaIds?: string[] };
    await tx.run('UPDATE outbox SET payload = ? WHERE seq = ?', [JSON.stringify({ ...payload, mediaIds: (payload.mediaIds ?? []).filter((x) => x !== mediaId) }), q.seq]);
  }
  // Only a task the phone holds shows the note (a manager's instruction photo of a task never pulled has none).
  if (errorKey && (await tx.first('SELECT 1 AS one FROM tasks WHERE id = ?', [taskId]))) {
    await tx.run(`INSERT OR REPLACE INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES (?, 'task', ?, NULL, ?, ?)`, [
      mediaId, taskId, errorKey, iso(now),
    ]);
  }
}

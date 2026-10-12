import {
  isFinalTaskStatus,
  type MediaKind,
  TASK_LIMITS,
  type TaskAction,
  taskEvidenceMet,
  type TaskEvidenceResult,
  type TaskMediaRole,
  type TaskStatus,
  taskTransition,
} from '@taskop/contracts';
import type { Db } from './db';
import { type CapturedMedia, LiveOnlyError, MediaLimitError, type MediaRefusal, type StoreDeps, type WriteKind } from './execution-store';
import { type DraftRow, iso, type LocalMedia, type LocalTask, type MediaRow, type TaskDraft, type TaskRow, toDraft, toMedia, toTask } from './local-model';
import { appendCommand } from './outbox';
import { taskMediaBody } from './task-records';

/** What the server would refuse with TASK_STATE_INVALID; `edit` covers the draft (text and response media). */
export class TaskStateError extends Error {
  constructor(
    readonly status: TaskStatus,
    readonly action: TaskAction | 'edit',
  ) {
    super(`Task is ${status}: ${action} is not allowed`);
    this.name = 'TaskStateError';
  }
}

export interface TaskView extends LocalTask {
  draft: TaskDraft | null;
  /** Commands of the task are still on the phone (waiting or failed). */
  unsynced: boolean;
  /** The i18n key of a command of the task the server refused and that waits for "Yenidən cəhd et" or "Sil". */
  failedKey: string | null;
}

/** A team task on offer: nobody has accepted it, on the server or on this phone. */
export const isTeamOffer = (t: LocalTask): boolean => t.server.assignee === null && t.server.team !== null && t.status === 'new';

/** "Gecikib" (FR-14.09): flagged by the server's sweep (kept after completion), or past due by the phone's clock while open. */
export const isTaskOverdue = (t: LocalTask, now: number): boolean =>
  t.server.overdueAt !== null || (!isFinalTaskStatus(t.status) && t.server.dueAt !== null && Date.parse(t.server.dueAt) <= now);

/** The response changes only while the task is in progress and not yet submitted (decision 5). */
export const canEditDraft = (t: TaskView): boolean => t.status === 'in_progress' && (t.draft?.submittedAt ?? null) === null;

export const RESPONSE_LIMITS: Readonly<Record<MediaKind, number>> = { photo: TASK_LIMITS.responsePhotos, video: TASK_LIMITS.responseVideos };

export function createTaskStore(deps: Pick<StoreDeps, 'db' | 'clock' | 'newId' | 'files' | 'feed' | 'onWrite'>) {
  const { db, clock, newId, files, feed, onWrite } = deps;

  const changed = (kind: WriteKind) => {
    feed.emit();
    onWrite(kind);
  };

  async function load(tx: Db, taskId: string): Promise<LocalTask> {
    const row = await tx.first<TaskRow>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Unknown task ${taskId}`);
    return toTask(row);
  }

  /** The task's draft, created with its submission id on first use. */
  async function draftOf(tx: Db, taskId: string, now: number): Promise<TaskDraft> {
    const row = await tx.first<DraftRow>('SELECT * FROM task_drafts WHERE task_id = ?', [taskId]);
    if (row) return toDraft(row);
    const draft: TaskDraft = { taskId, submissionId: newId(), text: '', mediaIds: [], submittedAt: null, updatedAt: iso(now) };
    await tx.run('INSERT INTO task_drafts (task_id, submission_id, text, media_ids, updated_at) VALUES (?, ?, ?, ?, ?)', [
      taskId, draft.submissionId, draft.text, '[]', draft.updatedAt,
    ]);
    return draft;
  }

  /** The task and its draft when the response may change; TaskStateError otherwise. */
  async function editable(tx: Db, taskId: string, now: number): Promise<{ task: LocalTask; draft: TaskDraft }> {
    const task = await load(tx, taskId);
    if (task.status !== 'in_progress') throw new TaskStateError(task.status, 'edit');
    const draft = await draftOf(tx, taskId, now);
    if (draft.submittedAt !== null) throw new TaskStateError(task.status, 'edit');
    return { task, draft };
  }

  const saveDraft = (tx: Db, d: TaskDraft, now: number) =>
    tx.run('UPDATE task_drafts SET text = ?, media_ids = ?, updated_at = ? WHERE task_id = ?', [d.text, JSON.stringify(d.mediaIds), iso(now), d.taskId]);

  const kindsOf = (tx: Db, ids: readonly string[]) =>
    tx.all<{ kind: MediaKind }>('SELECT kind FROM media WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)]);

  /** One medium of the task and its registration command (spec §7.1: queued before the submission that lists it). */
  async function addMedium(tx: Db, taskId: string, m: CapturedMedia, role: TaskMediaRole, now: number): Promise<string> {
    const mediaId = newId();
    await tx.run(
      `INSERT INTO media (id, owner_type, owner_id, item_id, role, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
       VALUES (?, 'task', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mediaId, taskId, role, m.kind, m.source, m.mime, m.bytes, m.width, m.height, m.durationMs, m.capturedAt, m.localUri],
    );
    await appendCommand(tx, { entityType: 'task', entityId: taskId, kind: 'task.media', refId: mediaId, payload: { ...taskMediaBody({ ...m, id: mediaId }, role) }, createdAt: iso(now) });
    return mediaId;
  }

  /** Accept or start: the new local status and its command in one transaction. `start` on a new task also accepts it (spec §3). */
  async function act(taskId: string, action: 'accept' | 'start'): Promise<void> {
    const now = clock.now();
    await db.transaction(async (tx) => {
      const task = await load(tx, taskId);
      const next = taskTransition(task.status, action, { requiresReview: task.server.requiresReview });
      if (!next) throw new TaskStateError(task.status, action);
      await tx.run('UPDATE tasks SET local_status = ?, sync_note = NULL, updated_at = ? WHERE id = ?', [next, iso(now), taskId]);
      await appendCommand(tx, {
        entityType: 'task', entityId: taskId, kind: action === 'accept' ? 'task.accept' : 'task.start', payload: { at: iso(now) }, createdAt: iso(now),
      });
    });
    // The first accept to reach the server owns a team task (spec §1): sync at once, like a checklist claim (decision 15).
    changed('claim');
  }

  async function attachMedia(taskId: string, m: CapturedMedia): Promise<string> {
    const now = clock.now();
    const mediaId = await db.transaction(async (tx) => {
      const { task, draft } = await editable(tx, taskId, now);
      const { evidence } = task.server;
      if (evidence[m.kind] === 'none') throw new MediaLimitError();
      if (evidence.liveOnly && m.source === 'gallery') throw new LiveOnlyError();
      const kinds = await kindsOf(tx, draft.mediaIds);
      if (kinds.filter((k) => k.kind === m.kind).length >= RESPONSE_LIMITS[m.kind]) throw new MediaLimitError();
      // A new medium replaces the note about one the server refused.
      await tx.run(`DELETE FROM media_refusals WHERE owner_type = 'task' AND owner_id = ?`, [taskId]);
      const id = await addMedium(tx, taskId, m, 'response', now);
      await saveDraft(tx, { ...draft, mediaIds: [...draft.mediaIds, id] }, now);
      return id;
    });
    changed('change');
    return mediaId;
  }

  async function removeMedia(taskId: string, mediaId: string): Promise<void> {
    const now = clock.now();
    const discarded = await db.transaction(async (tx) => {
      const { draft } = await editable(tx, taskId, now);
      const row = await tx.first<MediaRow>(`SELECT * FROM media WHERE id = ? AND owner_type = 'task' AND owner_id = ?`, [mediaId, taskId]);
      await saveDraft(tx, { ...draft, mediaIds: draft.mediaIds.filter((x) => x !== mediaId) }, now);
      if (!row || row.registered_at !== null) return null;
      // Never registered on the server: forget it entirely.
      await tx.run(`DELETE FROM outbox WHERE kind = 'task.media' AND ref_id = ?`, [mediaId]);
      await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
      return row.local_uri;
    });
    if (discarded) files.remove(discarded);
    changed('change');
  }

  /** Autosave (CommitInput): the draft only, no command; the text goes with Tamamla. */
  async function saveText(taskId: string, text: string): Promise<void> {
    if (text.length > TASK_LIMITS.submissionTextMax) throw new RangeError(`A response holds at most ${TASK_LIMITS.submissionTextMax} characters`);
    const now = clock.now();
    await db.transaction(async (tx) => {
      const { draft } = await editable(tx, taskId, now);
      await saveDraft(tx, { ...draft, text }, now);
    });
    feed.emit();
  }

  /** Tamamla: checks the status table and the evidence rules, then submits the draft with its submission id. */
  async function submit(taskId: string): Promise<TaskEvidenceResult> {
    const now = clock.now();
    const out = await db.transaction(async (tx): Promise<TaskEvidenceResult> => {
      const task = await load(tx, taskId);
      const next = taskTransition(task.status, 'submit', { requiresReview: task.server.requiresReview });
      if (!next) throw new TaskStateError(task.status, 'submit');
      const draft = await draftOf(tx, taskId, now);
      if (draft.submittedAt !== null) throw new TaskStateError(task.status, 'submit');
      const evidence = taskEvidenceMet(task.server.evidence, await kindsOf(tx, draft.mediaIds));
      if (!evidence.ok) return evidence;
      const submittedAt = iso(now);
      await tx.run('UPDATE task_drafts SET submitted_at = ?, updated_at = ? WHERE task_id = ?', [submittedAt, submittedAt, taskId]);
      await tx.run('UPDATE tasks SET local_status = ?, sync_note = NULL, updated_at = ? WHERE id = ?', [next, submittedAt, taskId]);
      await appendCommand(tx, {
        entityType: 'task', entityId: taskId, kind: 'task.submit', refId: draft.submissionId,
        payload: { id: draft.submissionId, text: draft.text, mediaIds: draft.mediaIds, submittedAt }, createdAt: submittedAt,
      });
      return { ok: true };
    });
    if (out.ok) changed('change');
    return out;
  }

  /** After an online create (decision 9): the instruction photos register and upload through the outbox and the media queue. */
  async function queueInstructionMedia(taskId: string, photos: readonly CapturedMedia[]): Promise<void> {
    if (photos.length > TASK_LIMITS.instructionMedia) throw new MediaLimitError();
    const now = clock.now();
    await db.transaction(async (tx) => {
      for (const m of photos) await addMedium(tx, taskId, m, 'instruction', now);
    });
    changed('claim');
  }

  async function views(rows: TaskRow[]): Promise<TaskView[]> {
    const drafts = new Map((await db.all<DraftRow>('SELECT * FROM task_drafts')).map((r) => [r.task_id, toDraft(r)]));
    const queued = await db.all<{ entity_id: string; failed_key: string | null }>(
      `SELECT entity_id, max(CASE WHEN status = 'failed' THEN coalesce(error_key, 'errors.INTERNAL') END) AS failed_key
       FROM outbox WHERE entity_type = 'task' GROUP BY entity_id`,
    );
    const byTask = new Map(queued.map((q) => [q.entity_id, q.failed_key]));
    return rows.map((r) => {
      const task = toTask(r);
      return { ...task, draft: drafts.get(task.id) ?? null, unsynced: byTask.has(task.id), failedKey: byTask.get(task.id) ?? null };
    });
  }

  return {
    tasks: async (): Promise<TaskView[]> => views(await db.all<TaskRow>('SELECT * FROM tasks ORDER BY id')),
    async task(id: string): Promise<TaskView | null> {
      return (await views(await db.all<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id])))[0] ?? null;
    },
    /** The response media the phone holds for the task (attached here), by capture time. */
    async media(taskId: string): Promise<LocalMedia[]> {
      const rows = await db.all<MediaRow>(`SELECT * FROM media WHERE owner_type = 'task' AND owner_id = ? AND role = 'response' ORDER BY captured_at, id`, [taskId]);
      return rows.map(toMedia);
    },
    async refusals(taskId: string): Promise<MediaRefusal[]> {
      const rows = await db.all<{ media_id: string; item_id: string | null; error_key: string }>(
        `SELECT media_id, item_id, error_key FROM media_refusals WHERE owner_type = 'task' AND owner_id = ? ORDER BY created_at, media_id`,
        [taskId],
      );
      return rows.map((r) => ({ mediaId: r.media_id, itemId: r.item_id, errorKey: r.error_key }));
    },
    accept: (taskId: string) => act(taskId, 'accept'),
    start: (taskId: string) => act(taskId, 'start'),
    attachMedia,
    removeMedia,
    saveText,
    submit,
    queueInstructionMedia,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;

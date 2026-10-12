import type { Answers, ClaimRef, ClaimRejectionReason, ExecutionState, MediaKind, MediaSource, OccurrenceStatus, SyncTask, TaskMediaRole, TaskStatus } from '@taskop/contracts';
import type { EntityType } from './outbox';

export const iso = (ms: number): string => new Date(ms).toISOString();
/** Server instants in the same 24-character form as `iso`, so SQLite text comparison orders them correctly. */
export const normIso = (s: string): string => iso(Date.parse(s));

export interface OccurrenceRow {
  id: string;
  checklist_id: string;
  checklist_name: string;
  site_id: string;
  site_name: string;
  shift_name: string | null;
  local_date: string;
  starts_at: string;
  due_at: string;
  closes_at: string;
  status: string;
  checklist_version_id: string;
  claim_execution_id: string | null;
  claim_user_id: string | null;
  claim_name: string | null;
}

export interface LocalOccurrence {
  id: string;
  checklistId: string;
  checklistName: string;
  siteId: string;
  siteName: string;
  shiftName: string | null;
  localDate: string;
  startsAt: string;
  dueAt: string;
  closesAt: string;
  status: OccurrenceStatus;
  checklistVersionId: string;
  claim: ClaimRef | null;
}

export const toOccurrence = (r: OccurrenceRow): LocalOccurrence => ({
  id: r.id,
  checklistId: r.checklist_id,
  checklistName: r.checklist_name,
  siteId: r.site_id,
  siteName: r.site_name,
  shiftName: r.shift_name,
  localDate: r.local_date,
  startsAt: r.starts_at,
  dueAt: r.due_at,
  closesAt: r.closes_at,
  status: r.status as OccurrenceStatus,
  checklistVersionId: r.checklist_version_id,
  claim:
    r.claim_execution_id && r.claim_user_id
      ? { executionId: r.claim_execution_id, executorUserId: r.claim_user_id, executorName: r.claim_name ?? '' }
      : null,
});

/** Whether the server has answered this execution's claim. */
export type ClaimStatus = 'pending' | 'accepted' | 'rejected';

export interface ExecutionRow {
  id: string;
  occurrence_id: string;
  checklist_version_id: string;
  state: string;
  claim: string;
  rejected_reason: string | null;
  rejected_by: string | null;
  started_at: string;
  completed_at: string | null;
  locked_at: string | null;
  answers: string;
  rev: number;
  synced_rev: number;
  finished_synced_at: string | null;
  updated_at: string;
  sync_note: string | null;
}

export interface LocalExecution {
  id: string;
  occurrenceId: string;
  checklistVersionId: string;
  state: ExecutionState;
  claim: ClaimStatus;
  rejectedReason: ClaimRejectionReason | null;
  /** The name of the worker whose claim won, when ours was rejected. */
  rejectedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  lockedAt: string | null;
  answers: Answers;
  rev: number;
  syncedRev: number;
  finishedSyncedAt: string | null;
  updatedAt: string;
  /** The i18n key of why the server refused this execution's work for good ("Server qəbul etmədi: …"); null when none. */
  syncNote: string | null;
}

export const toExecution = (r: ExecutionRow): LocalExecution => ({
  id: r.id,
  occurrenceId: r.occurrence_id,
  checklistVersionId: r.checklist_version_id,
  state: r.state as ExecutionState,
  claim: r.claim as ClaimStatus,
  rejectedReason: r.rejected_reason as ClaimRejectionReason | null,
  rejectedBy: r.rejected_by,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  lockedAt: r.locked_at,
  answers: JSON.parse(r.answers) as Answers,
  rev: r.rev,
  syncedRev: r.synced_rev,
  finishedSyncedAt: r.finished_synced_at,
  updatedAt: r.updated_at,
  syncNote: r.sync_note,
});

export interface MediaRow {
  id: string;
  owner_type: string;
  owner_id: string;
  item_id: string | null;
  role: string | null;
  kind: string;
  source: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  captured_at: string;
  local_uri: string;
  registered_at: string | null;
  uploaded_at: string | null;
  failed_code: string | null;
  attempts: number;
  file_deleted_at: string | null;
}

export interface LocalMedia {
  id: string;
  ownerType: EntityType;
  /** The execution or task the medium belongs to. */
  ownerId: string;
  itemId: string | null;
  /** A task medium's role (`instruction` | `response`); null for execution media. */
  role: TaskMediaRole | null;
  kind: MediaKind;
  source: MediaSource;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string;
  localUri: string;
  registeredAt: string | null;
  uploadedAt: string | null;
  failedCode: string | null;
  attempts: number;
  fileDeletedAt: string | null;
}

export const toMedia = (r: MediaRow): LocalMedia => ({
  id: r.id,
  ownerType: r.owner_type as EntityType,
  ownerId: r.owner_id,
  itemId: r.item_id,
  role: r.role as TaskMediaRole | null,
  kind: r.kind as MediaKind,
  source: r.source as MediaSource,
  mime: r.mime,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  durationMs: r.duration_ms,
  capturedAt: r.captured_at,
  localUri: r.local_uri,
  registeredAt: r.registered_at,
  uploadedAt: r.uploaded_at,
  failedCode: r.failed_code,
  attempts: r.attempts,
  fileDeletedAt: r.file_deleted_at,
});

export interface TaskRow {
  id: string;
  data: string;
  local_status: string;
  rev: number;
  sync_note: string | null;
  received_at: string;
  updated_at: string;
}

export interface LocalTask {
  id: string;
  /** The server's copy as last received (/me/sync or a command's answer). */
  server: SyncTask;
  /** What the phone shows: the server's status, or the outcome of accept/start/submit commands not yet answered. */
  status: TaskStatus;
  /** The `rev` of `server`. */
  rev: number;
  /** The i18n key of why the server refused this task's work for good ("Server qəbul etmədi: …"); null when none. */
  syncNote: string | null;
  receivedAt: string;
  updatedAt: string;
}

export const toTask = (r: TaskRow): LocalTask => ({
  id: r.id,
  server: JSON.parse(r.data) as SyncTask,
  status: r.local_status as TaskStatus,
  rev: r.rev,
  syncNote: r.sync_note,
  receivedAt: r.received_at,
  updatedAt: r.updated_at,
});

export interface DraftRow {
  task_id: string;
  submission_id: string;
  text: string;
  media_ids: string;
  submitted_at: string | null;
  updated_at: string;
}

/** The response being written for a task (spec §7.1), autosaved. */
export interface TaskDraft {
  taskId: string;
  /** The client UUIDv7 the submission is sent with (idempotent on the server). */
  submissionId: string;
  text: string;
  mediaIds: string[];
  /** Set by Tamamla: the draft is then read-only until the server answers. */
  submittedAt: string | null;
  updatedAt: string;
}

export const toDraft = (r: DraftRow): TaskDraft => ({
  taskId: r.task_id,
  submissionId: r.submission_id,
  text: r.text,
  mediaIds: JSON.parse(r.media_ids) as string[],
  submittedAt: r.submitted_at,
  updatedAt: r.updated_at,
});

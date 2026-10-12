import { ApiError } from '@taskop/api-client';
import { MEDIA_LIMITS, type MediaKind } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/session';

export interface MediaMeta {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** waiting → uploading → done | failed (sent again on the next save). refused: never sent (type, size or no room). */
export type UploadState = 'waiting' | 'uploading' | 'done' | 'failed' | 'refused';

export interface PendingMedia {
  /** Fixed when the file is picked, so a retry re-sends the same registration (idempotent on id). */
  id: string;
  file: File;
  kind: MediaKind;
  meta: MediaMeta;
  capturedAt: string;
  state: UploadState;
  /** An i18n key. */
  error: string | null;
}

export type ReadMediaMeta = (file: File, kind: MediaKind) => Promise<MediaMeta>;

export function mediaKindOfMime(mime: string): MediaKind | null {
  if ((MEDIA_LIMITS.mimeTypes.photo as readonly string[]).includes(mime)) return 'photo';
  if ((MEDIA_LIMITS.mimeTypes.video as readonly string[]).includes(mime)) return 'video';
  return null;
}

/** The API's MEDIA_TOO_LARGE rule (photo ≤ 5 MB; video ≤ 60 MB, ≤ 60 s, short edge ≤ 720), checked before anything is sent. */
export function mediaFileIssue(kind: MediaKind, bytes: number, meta: MediaMeta): string | null {
  if (kind === 'photo') return bytes > MEDIA_LIMITS.photoMaxBytes ? 'tasks.dialog.photoTooLarge' : null;
  const tooLong = (meta.durationMs ?? 0) > MEDIA_LIMITS.videoMaxSeconds * 1000;
  const tooWide = Math.min(meta.width ?? 0, meta.height ?? 0) > MEDIA_LIMITS.videoMaxShortEdge;
  return bytes > MEDIA_LIMITS.videoMaxBytes || tooLong || tooWide ? 'tasks.dialog.videoTooLarge' : null;
}

/** Browser only (jsdom cannot decode): a photo's dimensions, a video's dimensions and length. The web never resizes or transcodes. */
export const readMediaMeta: ReadMediaMeta = async (file, kind) => {
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'photo') {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, durationMs: null };
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('metadata'));
      video.src = url;
    });
    return { width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(video.duration * 1000) };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Checks picked files in order; at most `room` of them are accepted (TASK_LIMITS.instructionMedia minus what the task has). */
export async function prepareFiles(files: readonly File[], room: number, read: ReadMediaMeta = readMediaMeta): Promise<PendingMedia[]> {
  let left = room;
  const out: PendingMedia[] = [];
  for (const file of files) {
    const kind = mediaKindOfMime(file.type);
    const meta = kind ? await read(file, kind).catch(() => null) : null;
    let error: string | null = kind && meta ? mediaFileIssue(kind, file.size, meta) : 'errors.MEDIA_TYPE_INVALID';
    if (!error && left <= 0) error = 'tasks.dialog.mediaLimit';
    if (!error) left -= 1;
    out.push({
      id: uuidv7(),
      file,
      kind: kind ?? 'photo',
      meta: meta ?? { width: null, height: null, durationMs: null },
      capturedAt: new Date().toISOString(),
      state: error ? 'refused' : 'waiting',
      error,
    });
  }
  return out;
}

/** Instruction uploads speak of "the computer" and "instruction files", not the phone and question texts of SP4. */
const UPLOAD_ERRORS: Record<string, string> = {
  CLOCK_INVALID: 'tasks.dialog.uploadClock',
  MEDIA_LIMIT_REACHED: 'tasks.dialog.uploadLimit',
};

/** The picked time, but never later than the server's own timestamp for the task (a laptop clock ahead is CLOCK_INVALID). */
function capturedAtFor(picked: string, serverTime: string): string {
  return Date.parse(picked) > Date.parse(serverTime) ? serverTime : picked;
}

/**
 * For each waiting or failed file, in order: POST /tasks/:id/media → PUT the file to the presigned URL (skipped when
 * the medium is already stored) → POST /task-media/:id/uploaded. A failure is recorded and the next file still goes.
 * `serverTime` is the `createdAt` (right after create) or `updatedAt` (after an edit) of the latest task response.
 */
export async function uploadInstructionMedia(
  taskId: string,
  items: readonly PendingMedia[],
  serverTime: string,
  onChange: (id: string, patch: Partial<PendingMedia>) => void,
): Promise<number> {
  let failed = 0;
  for (const m of items) {
    if (m.state !== 'waiting' && m.state !== 'failed') continue;
    onChange(m.id, { state: 'uploading', error: null });
    try {
      const ticket = await api.tasks.registerMedia(taskId, {
        id: m.id,
        role: 'instruction',
        kind: m.kind,
        source: 'gallery',
        mime: m.file.type,
        bytes: m.file.size,
        width: m.meta.width,
        height: m.meta.height,
        durationMs: m.meta.durationMs,
        capturedAt: capturedAtFor(m.capturedAt, serverTime),
      });
      if (ticket.uploadUrl) {
        const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: m.file });
        if (!res.ok) throw new Error(`upload ${res.status}`);
      }
      await api.taskMedia.confirmUploaded(m.id);
      onChange(m.id, { state: 'done' });
    } catch (e) {
      failed += 1;
      const error = e instanceof ApiError ? (UPLOAD_ERRORS[e.code] ?? e.messageKey) : 'tasks.dialog.uploadError';
      onChange(m.id, { state: 'failed', error });
    }
  }
  return failed;
}

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

/** What the browser's decoders are asked through; replaced in tests (jsdom cannot decode). */
export interface MetaReaders {
  createImage: () => HTMLImageElement;
  createVideo: () => HTMLVideoElement;
  timeoutMs: number;
}

const DEFAULT_READERS: MetaReaders = { createImage: () => new Image(), createVideo: () => document.createElement('video'), timeoutMs: 10_000 };

/** A size or length the browser reports as 0, NaN or Infinity (a stream, a codec it cannot read) is unknown, not a value. */
const known = (n: number): number | null => (Number.isFinite(n) && n > 0 ? n : null);

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('metadata timeout')), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error('metadata'));
      },
    );
  });

/**
 * Browser only (jsdom cannot decode): a photo's dimensions, a video's dimensions and length; ~10 s at most. Whatever the
 * browser cannot tell is null. The web never resizes or transcodes.
 */
export const readMediaMeta = async (file: File, kind: MediaKind, readers: Partial<MetaReaders> = {}): Promise<MediaMeta> => {
  const { createImage, createVideo, timeoutMs } = { ...DEFAULT_READERS, ...readers };
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'photo') {
      const img = createImage();
      img.src = url;
      await withTimeout(img.decode(), timeoutMs);
      return { width: known(img.naturalWidth), height: known(img.naturalHeight), durationMs: null };
    }
    const video = createVideo();
    video.preload = 'metadata';
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('metadata'));
        video.src = url;
      }),
      timeoutMs,
    );
    const seconds = known(video.duration);
    return { width: known(video.videoWidth), height: known(video.videoHeight), durationMs: seconds === null ? null : Math.round(seconds * 1000) };
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
    const measured = kind ? await read(file, kind).catch(() => null) : null;
    // A video the browser cannot decode (a codec it lacks) is still a video of an allowed type: the API takes it without
    // dimensions and length. A photo it cannot decode is not a picture.
    const meta = measured ?? (kind === 'video' ? { width: null, height: null, durationMs: null } : null);
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
 *
 * `serverTime` is the `createdAt` (a create) or `updatedAt` (a PATCH) the server answered with in THIS save, and the
 * files are stamped no later than it. Without one (a save that sent no request: only files to add, or a retry of failed
 * ones) the picked time is sent; if the API then answers CLOCK_INVALID (the computer's clock is ahead), that file is sent
 * once more, stamped no later than the task's `updatedAt` from a fresh GET.
 */
export async function uploadInstructionMedia(
  taskId: string,
  items: readonly PendingMedia[],
  serverTime: string | null,
  onChange: (id: string, patch: Partial<PendingMedia>) => void,
): Promise<number> {
  let failed = 0;
  let fresh: Promise<string | null> | null = null;
  const freshServerTime = () => (fresh ??= api.tasks.get(taskId).then((t) => t.updatedAt, () => null));
  for (const m of items) {
    if (m.state !== 'waiting' && m.state !== 'failed') continue;
    onChange(m.id, { state: 'uploading', error: null });
    const register = (capturedAt: string) =>
      api.tasks.registerMedia(taskId, {
        id: m.id,
        role: 'instruction',
        kind: m.kind,
        source: 'gallery',
        mime: m.file.type,
        bytes: m.file.size,
        width: m.meta.width,
        height: m.meta.height,
        durationMs: m.meta.durationMs,
        capturedAt,
      });
    try {
      let ticket;
      try {
        ticket = await register(serverTime ? capturedAtFor(m.capturedAt, serverTime) : m.capturedAt);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'CLOCK_INVALID' && serverTime === null)) throw e;
        const bound = await freshServerTime();
        if (!bound || Date.parse(m.capturedAt) <= Date.parse(bound)) throw e;
        ticket = await register(bound);
      }
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

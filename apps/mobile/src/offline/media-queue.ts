import type { MediaUploadTicket } from '@taskop/contracts';
import type { ChangeFeed } from './change-feed';
import { clampOffset, type Clock, readOffset } from './clock';
import type { Db } from './db';
import { mediaRegisterBody } from './execution-store';
import { iso, type LocalMedia, type MediaRow, toMedia } from './local-model';
import { classifyError, type SyncApi } from './sync-api';
import type { FileRemover } from './user-scope';

export interface MediaTransport extends FileRemover {
  exists(uri: string): boolean;
  /** PUTs the file's bytes to a presigned URL with exactly `headers`; resolves with the HTTP status. */
  upload(uri: string, url: string, headers: Record<string, string>): Promise<number>;
}

export const MEDIA_MAX_ATTEMPTS = 5;
/** One presigned PUT may take this long (a 60 s video on a slow link); longer counts as a network failure. */
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;
export const LOCAL_FILE_KEEP_DAYS = 7;
const DAY_MS = 86_400_000;

export type DrainOutcome = 'ok' | 'retry' | 'auth';

/** An upload that did not settle in UPLOAD_TIMEOUT_MS: a network failure (retried later, never counted as an attempt). */
export class UploadTimeoutError extends Error {
  constructor() {
    super('The upload did not finish in time');
    this.name = 'UploadTimeoutError';
  }
}

/** Bounds a transport upload by UPLOAD_TIMEOUT_MS (the native upload cannot be aborted, only abandoned). */
export function withUploadTimeout<T>(upload: Promise<T>, ms: number = UPLOAD_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new UploadTimeoutError()), ms);
  });
  return Promise.race([upload, expired]).finally(() => clearTimeout(timer));
}

export interface MediaQueueEntry {
  id: string;
  kind: LocalMedia['kind'];
  checklistName: string | null;
  failedCode: string | null;
  attempts: number;
}

export interface MediaQueue {
  /**
   * Uploads every waiting file, one at a time, photos first. Stops at the first retryable failure, and returns 'ok'
   * early once `shouldStop` says so (checked between media: the engine stopped for a logout or a user switch).
   */
  drain(shouldStop?: () => boolean): Promise<DrainOutcome>;
  /** Deletes local files uploaded and finished syncing more than 7 days ago. Returns how many. */
  cleanup(): Promise<number>;
  counts(): Promise<{ pending: number; failed: number }>;
  list(): Promise<MediaQueueEntry[]>;
  retryFailed(): Promise<void>;
}

/** The i18n key for a medium's failure: local reasons under mobile.sync.mediaErrors, API codes under errors. */
export const mediaErrorKey = (code: string): string =>
  code === 'FILE_MISSING' || code === 'UPLOAD_FAILED' ? `mobile.sync.mediaErrors.${code}` : `errors.${code}`;

/** Registered through the outbox, not uploaded, not parked. */
const WAITING = 'registered_at IS NOT NULL AND uploaded_at IS NULL AND failed_code IS NULL AND file_deleted_at IS NULL';

/** What one medium's step tells the drain loop: an outcome stops it, 'next' moves on to the next medium. */
type Step = DrainOutcome | 'next';

export function createMediaQueue(deps: {
  db: Db;
  api: SyncApi;
  clock: Clock;
  transport: MediaTransport;
  feed: ChangeFeed;
  /** A transport error while offline is the network; while online it counts as an attempt. */
  isOnline: () => boolean;
}): MediaQueue {
  const { db, api, clock, transport, feed, isOnline } = deps;

  // The worker may remove a medium while it is in flight: every update below finds no row then, and the queue
  // simply stops for that medium.

  async function park(id: string, code: string): Promise<'next'> {
    const n = await db.run('UPDATE media SET failed_code = ?, attempts = attempts + 1 WHERE id = ?', [code, id]);
    if (n > 0) feed.emit();
    return 'next';
  }

  /**
   * A failure a later try may fix (bad PUT status, no upload URL, confirm before the object landed, the transport
   * throwing while online). Network errors never count.
   */
  async function countAttempt(id: string): Promise<Step> {
    const n = await db.run('UPDATE media SET attempts = attempts + 1 WHERE id = ?', [id]);
    if (n === 0) return 'next';
    const parked = await db.run(`UPDATE media SET failed_code = 'UPLOAD_FAILED' WHERE id = ? AND attempts >= ?`, [id, MEDIA_MAX_ATTEMPTS]);
    if (parked > 0) feed.emit();
    return 'retry';
  }

  async function markUploaded(id: string): Promise<'next'> {
    const n = await db.run('UPDATE media SET uploaded_at = ? WHERE id = ?', [iso(clock.now()), id]);
    if (n > 0) feed.emit();
    return 'next';
  }

  async function uploadOne(m: LocalMedia): Promise<Step> {
    if (!transport.exists(m.localUri)) return park(m.id, 'FILE_MISSING');
    let ticket: MediaUploadTicket;
    try {
      // Registering a known ID again only returns a fresh presigned URL (Part 1 Task 10, decision 1).
      ticket = await api.executions.registerMedia(m.executionId, {
        ...mediaRegisterBody(m),
        deviceTime: iso(clock.now()),
        clientOffsetMs: clampOffset(await readOffset(db)),
      });
    } catch (e) {
      const f = classifyError(e);
      return f.kind === 'permanent' ? park(m.id, f.code) : f.kind;
    }
    // The server already has the file: nothing to PUT or confirm.
    if (ticket.status === 'uploaded') return markUploaded(m.id);
    if (ticket.uploadUrl === null) return countAttempt(m.id);
    let status: number;
    try {
      status = await transport.upload(m.localUri, ticket.uploadUrl, ticket.headers);
    } catch (e) {
      // A timeout or a lost connection is retried freely; anything else that keeps failing must not block the queue forever.
      return e instanceof UploadTimeoutError || !isOnline() ? 'retry' : countAttempt(m.id);
    }
    if (status < 200 || status >= 300) return countAttempt(m.id);
    try {
      await api.media.confirmUploaded(m.id);
    } catch (e) {
      const f = classifyError(e);
      if (f.kind === 'permanent' && f.code === 'MEDIA_NOT_FOUND_IN_STORAGE') return countAttempt(m.id);
      return f.kind === 'permanent' ? park(m.id, f.code) : f.kind;
    }
    return markUploaded(m.id);
  }

  return {
    async drain(shouldStop = () => false) {
      for (;;) {
        if (shouldStop()) return 'ok';
        const row = await db.first<MediaRow>(`SELECT * FROM media WHERE ${WAITING} ORDER BY CASE kind WHEN 'photo' THEN 0 ELSE 1 END, captured_at, id LIMIT 1`);
        if (!row) return 'ok';
        const outcome = await uploadOne(toMedia(row));
        if (outcome !== 'next') return outcome;
      }
    },
    async cleanup() {
      const now = clock.now();
      const due = await db.all<{ id: string; local_uri: string }>(
        `SELECT m.id, m.local_uri FROM media m JOIN executions e ON e.id = m.execution_id
         WHERE m.uploaded_at IS NOT NULL AND m.file_deleted_at IS NULL
           AND e.finished_synced_at IS NOT NULL AND e.finished_synced_at <= ?`,
        [iso(now - LOCAL_FILE_KEEP_DAYS * DAY_MS)],
      );
      for (const r of due) {
        try {
          transport.remove(r.local_uri);
        } catch {
          // Already gone.
        }
        await db.run('UPDATE media SET file_deleted_at = ? WHERE id = ?', [iso(now), r.id]);
      }
      return due.length;
    },
    async counts() {
      const r = await db.first<{ pending: number; failed: number }>(
        `SELECT (SELECT count(*) FROM media WHERE ${WAITING}) AS pending,
                (SELECT count(*) FROM media WHERE failed_code IS NOT NULL AND uploaded_at IS NULL) AS failed`,
      );
      return { pending: r?.pending ?? 0, failed: r?.failed ?? 0 };
    },
    async list() {
      const found = await db.all<{ id: string; kind: LocalMedia['kind']; checklist_name: string | null; failed_code: string | null; attempts: number }>(
        `SELECT m.id, m.kind, oc.checklist_name, m.failed_code, m.attempts FROM media m
         JOIN executions e ON e.id = m.execution_id
         LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
         WHERE m.registered_at IS NOT NULL AND m.uploaded_at IS NULL AND m.file_deleted_at IS NULL
         ORDER BY CASE m.kind WHEN 'photo' THEN 0 ELSE 1 END, m.captured_at, m.id`,
      );
      return found.map((r) => ({ id: r.id, kind: r.kind, checklistName: r.checklist_name, failedCode: r.failed_code, attempts: r.attempts }));
    },
    async retryFailed() {
      await db.run('UPDATE media SET failed_code = NULL, attempts = 0 WHERE failed_code IS NOT NULL AND uploaded_at IS NULL');
      feed.emit();
    },
  };
}

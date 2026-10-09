import type {
  Answers,
  ClaimCommand,
  ClaimRejectionReason,
  ClaimResult,
  CompleteCommand,
  CompleteResult,
  MediaUploadTicket,
  RegisterMediaCommand,
  SaveAnswersCommand,
  SaveAnswersResult,
  SyncResponse,
} from '@taskop/contracts';
import type { ChangeFeed } from './change-feed';
import { clampOffset, type Clock, measureOffset, readOffset } from './clock';
import { type Db, getMeta } from './db';
import { withoutMedia } from './execution-store';
import { type ExecutionRow, iso, normIso, toExecution } from './local-model';
import type { MediaQueue } from './media-queue';
import { ackCommand, appendCommand, failCommand, nextCommand, noteAttempt, type OutboxCommand, outboxCounts, retryFailedCommands } from './outbox';
import { classifyError, type SyncApi } from './sync-api';
import { applyPull, knownVersionIds } from './sync-pull';
import type { FileRemover } from './user-scope';

export type SyncTrigger = 'start' | 'reconnect' | 'foreground' | 'interval' | 'local' | 'claim' | 'manual' | 'retry';

/** These wait out a running backoff; the others run at once (decision 14). */
const WAITS_FOR_BACKOFF: ReadonlySet<SyncTrigger> = new Set(['interval', 'local']);

export const BACKOFF = { firstMs: 5_000, maxMs: 300_000 } as const;

/** Spec §7.2: exponential from 5 s, capped at 5 min. */
export const backoffDelay = (failures: number): number => Math.min(BACKOFF.firstMs * 2 ** Math.max(failures - 1, 0), BACKOFF.maxMs);

export interface SyncStatus {
  /** Outbox commands and registered files still to send. */
  pending: number;
  failed: number;
  running: boolean;
  online: boolean;
  lastSyncedAt: string | null;
  clockOffsetMs: number;
  /** The API refused the session; commands wait for the next sign-in (decision 5). */
  blockedByAuth: boolean;
}

export type Indicator = 'synced' | 'pending' | 'offline' | 'failed';

/** Spec §7.3: red when something failed, amber while anything waits or the phone is offline, green otherwise. */
export function indicatorOf(s: SyncStatus): Indicator {
  if (s.failed > 0) return 'failed';
  if (s.pending > 0) return 'pending';
  if (!s.online) return 'offline';
  return 'synced';
}

export interface ClaimRejection {
  executionId: string;
  occurrenceId: string;
  reason: ClaimRejectionReason;
  /** Who holds the claim instead, when the server said. */
  byName: string | null;
}

export interface SyncEngineDeps {
  db: Db;
  api: SyncApi;
  clock: Clock;
  feed: ChangeFeed;
  mediaQueue: Pick<MediaQueue, 'drain' | 'cleanup' | 'counts' | 'retryFailed'>;
  /** Deletes the local file of a medium the server refused. */
  files: FileRemover;
  isOnline: () => boolean;
  onClaimRejected: (r: ClaimRejection) => void;
  /** Runs at the start of every run, online or not: the local closes_at lock. */
  beforeRun?: () => Promise<unknown>;
}

export interface SyncEngine {
  /** Single-flight: a call during a run schedules one more pass and resolves when the runs end. */
  run(trigger?: SyncTrigger): Promise<void>;
  /** Resolves when no run is in progress. */
  idle(): Promise<void>;
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** "Yenidən cəhd et": failed commands and files go back to pending, then a run starts. */
  retryFailed(): Promise<void>;
  stop(): void;
}

type Outcome = 'ok' | 'retry' | 'auth';

/** An execution has finished syncing when it left `active` and none of its commands is left (decision 8). */
export async function markFinishedSynced(db: Db, now: number): Promise<void> {
  await db.run(
    `UPDATE executions SET finished_synced_at = ?
     WHERE state <> 'active' AND finished_synced_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.execution_id = executions.id)`,
    [iso(now)],
  );
}

const refersTo = (answers: Answers, mediaId: string): boolean =>
  Object.values(answers).some((a) => a?.photos?.includes(mediaId) || a?.videos?.includes(mediaId) || a?.problem?.mediaIds.includes(mediaId));

/** Gives every queued answers/complete command of an execution a new revision (payload and column alike). */
async function requeueRevision(tx: Db, executionId: string, rev: number, answers: Answers | null): Promise<number> {
  const queued = await tx.all<{ seq: number; payload: string }>(
    `SELECT seq, payload FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')`,
    [executionId],
  );
  for (const q of queued) {
    const payload = { ...(JSON.parse(q.payload) as Record<string, unknown>), rev, ...(answers ? { answers } : {}) };
    await tx.run('UPDATE outbox SET rev = ?, payload = ? WHERE seq = ?', [rev, JSON.stringify(payload), q.seq]);
  }
  return queued.length;
}

/**
 * The server refused a medium for good (MEDIA_TOO_LARGE, EVIDENCE_LIVE_ONLY, …). The medium is deleted and dropped
 * from the answers under a new revision, so the answers and completion still queued do not fail on an unknown medium;
 * the item's evidence requirement shows as missing again, the worker's signal to retake it.
 * Registration always precedes the answers that reference a medium, so every revision naming it is still queued: those
 * commands are rewritten in place, keeping their action time (an answer made before closes_at stays before it) and
 * their order before a completion. Only when none is queued is a new answers command appended.
 * Returns the local file to delete after the transaction commits.
 */
async function dropRefusedMedium(tx: Db, cmd: OutboxCommand, now: number): Promise<string | null> {
  await ackCommand(tx, cmd.seq);
  const mediaId = cmd.refId;
  if (!mediaId) return null;
  // The worker may have removed the medium meanwhile: removeMedia already dropped it from the answers.
  const medium = await tx.first<{ local_uri: string }>('SELECT local_uri FROM media WHERE id = ?', [mediaId]);
  if (!medium) return null;
  await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
  const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [cmd.executionId]);
  if (!row) return medium.local_uri;
  const e = toExecution(row);
  if (!refersTo(e.answers, mediaId)) return medium.local_uri;
  const answers = withoutMedia(e.answers, mediaId);
  const rev = e.rev + 1;
  await tx.run('UPDATE executions SET answers = ?, rev = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), rev, iso(now), e.id]);
  if ((await requeueRevision(tx, e.id, rev, answers)) === 0) {
    await appendCommand(tx, { executionId: e.id, kind: 'answers', rev, payload: { rev, answers }, createdAt: iso(now) });
  }
  return medium.local_uri;
}

/**
 * My other install already holds the claim: this phone continues that execution instead of losing its work.
 * The local execution, its media and its queued commands move to the server's execution ID. A copy of that execution
 * pulled earlier is replaced, since the local one carries the queued work; the local revisions are renumbered above
 * the copy's so the server does not ignore them as stale (same user: this phone's later edits win).
 */
async function adoptExecution(tx: Db, from: string, to: string, now: number): Promise<void> {
  const pulled = await tx.first<{ rev: number }>('SELECT rev FROM executions WHERE id = ?', [to]);
  await tx.run('DELETE FROM executions WHERE id = ?', [to]);
  await tx.run(`UPDATE executions SET id = ?, claim = 'accepted', updated_at = ? WHERE id = ?`, [to, iso(now), from]);
  await tx.run('UPDATE media SET execution_id = ? WHERE execution_id = ?', [to, from]);
  await tx.run('UPDATE outbox SET execution_id = ? WHERE execution_id = ?', [to, from]);
  const shift = pulled?.rev ?? 0;
  if (shift === 0) return;
  await tx.run('UPDATE executions SET rev = rev + ?, synced_rev = ? WHERE id = ?', [shift, shift, to]);
  const queued = await tx.all<{ seq: number; rev: number; payload: string }>(
    `SELECT seq, rev, payload FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')`,
    [to],
  );
  for (const q of queued) {
    const rev = q.rev + shift;
    await tx.run('UPDATE outbox SET rev = ?, payload = ? WHERE seq = ?', [rev, JSON.stringify({ ...(JSON.parse(q.payload) as Record<string, unknown>), rev }), q.seq]);
  }
}

/**
 * The server ignored an answers revision because it already holds a newer one (another install of mine). This phone's
 * answers are sent again above the server's revision instead of being marked synced, so the next pull cannot overwrite them.
 */
async function requeueStaleAnswers(tx: Db, cmd: OutboxCommand, serverRev: number): Promise<void> {
  const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [cmd.executionId]);
  if (!row) return void (await ackCommand(tx, cmd.seq));
  const e = toExecution(row);
  // A newer local revision above the server's is already queued: it carries these answers.
  if (e.rev > serverRev) return void (await ackCommand(tx, cmd.seq));
  const rev = serverRev + 1;
  await tx.run('UPDATE executions SET rev = ? WHERE id = ?', [rev, e.id]);
  // The command stays where it is (its action time and its place before a completion), now with the new revision.
  if ((await requeueRevision(tx, e.id, rev, e.answers)) === 0) {
    await appendCommand(tx, { executionId: e.id, kind: 'answers', rev, payload: { rev, answers: e.answers }, createdAt: cmd.createdAt });
  }
}

/**
 * A completion refused for unmet requirements (e.g. a refused medium left an item without evidence) reopens the
 * execution while its window is still open, so the worker can fix it and complete again. After closes_at the
 * server's sweep makes it partial. A reopened execution drops the refused command (the next completion queues a fresh
 * one); otherwise the command is parked as failed. Returns whether it reopened.
 */
async function reopenRefusedCompletion(tx: Db, cmd: OutboxCommand, now: number): Promise<boolean> {
  const reopened = await tx.run(
    `UPDATE executions SET state = 'active', completed_at = NULL, finished_synced_at = NULL, updated_at = ?
     WHERE id = ? AND state = 'completed'
       AND EXISTS (SELECT 1 FROM occurrences o WHERE o.id = executions.occurrence_id AND o.closes_at > ?)`,
    [iso(now), cmd.executionId, iso(now)],
  );
  if (reopened > 0) await ackCommand(tx, cmd.seq);
  return reopened > 0;
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { db, api, clock, feed, mediaQueue, files, isOnline, onClaimRejected, beforeRun } = deps;
  let status: SyncStatus = { pending: 0, failed: 0, running: false, online: isOnline(), lastSyncedAt: null, clockOffsetMs: 0, blockedByAuth: false };
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function publish(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  }

  async function refresh(): Promise<void> {
    const outbox = await outboxCounts(db);
    const media = await mediaQueue.counts();
    publish({
      pending: outbox.pending + media.pending,
      failed: outbox.failed + media.failed,
      online: isOnline(),
      lastSyncedAt: await getMeta(db, 'lastSyncedAt'),
      clockOffsetMs: await readOffset(db),
    });
  }
  const unsubscribeFeed = feed.subscribe(() => void refresh().catch(() => undefined));

  function removeFile(uri: string): void {
    try {
      files.remove(uri);
    } catch {
      // Already gone.
    }
  }

  function clearRetry(): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(): void {
    failures += 1;
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void run('retry');
    }, backoffDelay(failures));
  }

  /** `deviceTime` is the worker's action time (the API refuses answers stamped at or after closes_at); the offset is the latest measured. */
  async function send(cmd: OutboxCommand): Promise<unknown> {
    const body = { ...cmd.payload, deviceTime: cmd.createdAt, clientOffsetMs: clampOffset(await readOffset(db)) };
    switch (cmd.kind) {
      case 'claim':
        return api.executions.claim(body as ClaimCommand);
      case 'media':
        return api.executions.registerMedia(cmd.executionId, body as RegisterMediaCommand);
      case 'answers':
        return api.executions.saveAnswers(cmd.executionId, body as SaveAnswersCommand);
      case 'complete':
        return api.executions.complete(cmd.executionId, body as CompleteCommand);
    }
  }

  /** Every update finds no row when the worker removed it while the command was in flight; that is not an error. */
  async function applyResult(tx: Db, cmd: OutboxCommand, result: unknown, now: number): Promise<ClaimRejection | null> {
    switch (cmd.kind) {
      case 'claim': {
        const r = result as ClaimResult;
        const e = await tx.first<{ occurrence_id: string }>('SELECT occurrence_id FROM executions WHERE id = ?', [cmd.executionId]);
        if (!e) return null;
        if (r.claim) {
          await tx.run('UPDATE occurrences SET claim_execution_id = ?, claim_user_id = ?, claim_name = ? WHERE id = ?', [
            r.claim.executionId, r.claim.executorUserId, r.claim.executorName, e.occurrence_id,
          ]);
        }
        const heldByMe = r.claim !== null && r.claim.executorUserId === (await getMeta(tx, 'userId'));
        if (r.state === 'rejected' && r.reason === 'ALREADY_CLAIMED' && heldByMe && r.claim!.executionId !== cmd.executionId) {
          await adoptExecution(tx, cmd.executionId, r.claim!.executionId, now);
        } else if (r.state === 'rejected') {
          await tx.run(`UPDATE executions SET state = 'rejected', claim = 'rejected', rejected_reason = ?, rejected_by = ?, updated_at = ? WHERE id = ?`, [
            r.reason, r.claim?.executorName ?? null, iso(now), cmd.executionId,
          ]);
          return { executionId: cmd.executionId, occurrenceId: e.occurrence_id, reason: r.reason ?? 'ALREADY_CLAIMED', byName: r.claim?.executorName ?? null };
        } else {
          await tx.run(`UPDATE executions SET claim = 'accepted', started_at = ?, updated_at = ? WHERE id = ?`, [normIso(r.startedAt), iso(now), cmd.executionId]);
        }
        await tx.run(`UPDATE occurrences SET status = 'started' WHERE id = ? AND status IN ('pending', 'overdue', 'missed')`, [e.occurrence_id]);
        return null;
      }
      case 'media': {
        const ticket = result as MediaUploadTicket;
        await tx.run('UPDATE media SET registered_at = ? WHERE id = ?', [iso(now), cmd.refId]);
        // The server already holds the file (uploadUrl is null then): nothing is left for the media queue.
        if (ticket.status === 'uploaded') await tx.run('UPDATE media SET uploaded_at = coalesce(uploaded_at, ?) WHERE id = ?', [iso(now), cmd.refId]);
        return null;
      }
      case 'answers':
        // max(): a late success for an older revision must never lower what is known to be synced.
        await tx.run('UPDATE executions SET synced_rev = max(synced_rev, ?) WHERE id = ?', [cmd.rev, cmd.executionId]);
        return null;
      case 'complete': {
        const r = result as CompleteResult;
        await tx.run(
          'UPDATE executions SET state = ?, completed_at = coalesce(?, completed_at), synced_rev = max(synced_rev, ?), updated_at = ? WHERE id = ?',
          [r.state, r.completedAt ? normIso(r.completedAt) : null, cmd.rev, iso(now), cmd.executionId],
        );
        return null;
      }
    }
  }

  async function push(): Promise<Outcome> {
    for (;;) {
      if (stopped) return 'ok';
      const cmd = await nextCommand(db);
      if (!cmd) return 'ok';
      let result: unknown;
      try {
        result = await send(cmd);
      } catch (e) {
        const f = classifyError(e);
        if (f.kind === 'permanent') {
          if (cmd.kind === 'media') {
            const uri = await db.transaction((tx) => dropRefusedMedium(tx, cmd, clock.now()));
            if (uri) removeFile(uri);
          } else {
            await db.transaction(async (tx) => {
              if (cmd.kind === 'complete' && f.code === 'REQUIREMENTS_UNMET' && (await reopenRefusedCompletion(tx, cmd, clock.now()))) return;
              await failCommand(tx, cmd.seq, f.code, f.messageKey);
            });
          }
          feed.emit();
          continue;
        }
        if (f.kind === 'retry') await noteAttempt(db, cmd.seq);
        return f.kind;
      }
      if (cmd.kind === 'answers' && (result as SaveAnswersResult).stale) {
        await db.transaction((tx) => requeueStaleAnswers(tx, cmd, (result as SaveAnswersResult).rev));
        feed.emit();
        continue;
      }
      // If the worker superseded or removed this command while it was in flight, ack deletes nothing and the newer one goes next.
      const rejection = await db.transaction(async (tx) => {
        const r = await applyResult(tx, cmd, result, clock.now());
        await ackCommand(tx, cmd.seq);
        return r;
      });
      feed.emit();
      if (rejection) onClaimRejected(rejection);
    }
  }

  async function pull(): Promise<Outcome> {
    const known = await knownVersionIds(db);
    const sentAt = clock.now();
    let res: SyncResponse;
    try {
      res = await api.sync.pull(known);
    } catch (e) {
      return classifyError(e).kind === 'auth' ? 'auth' : 'retry';
    }
    const receivedAt = clock.now();
    await applyPull(db, res, clampOffset(measureOffset(res.serverTime, sentAt, receivedAt)), receivedAt);
    feed.emit();
    return 'ok';
  }

  /** Strictly sequential: push, then pull, then the media queue (whose drain is not re-entrant: only this flight calls it). */
  async function cycle(): Promise<Outcome> {
    const pushed = await push();
    if (pushed !== 'ok' || stopped) return pushed;
    const pulled = await pull();
    if (pulled !== 'ok' || stopped) return pulled;
    const drained = await mediaQueue.drain();
    if (drained !== 'ok') return drained;
    await markFinishedSynced(db, clock.now());
    await mediaQueue.cleanup();
    return 'ok';
  }

  function run(trigger: SyncTrigger = 'manual'): Promise<void> {
    if (stopped) return Promise.resolve();
    if (WAITS_FOR_BACKOFF.has(trigger) && retryTimer) return running ?? Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      publish({ running: true });
      try {
        do {
          again = false;
          let outcome: Outcome;
          try {
            await beforeRun?.();
            if (!isOnline()) break;
            outcome = await cycle();
          } catch {
            // Anything unexpected (a local error included) backs off like a network failure, never an unhandled rejection.
            outcome = 'retry';
          }
          if (outcome === 'retry') {
            scheduleRetry();
            break;
          }
          if (outcome === 'auth') {
            publish({ blockedByAuth: true });
            break;
          }
          failures = 0;
          clearRetry();
          publish({ blockedByAuth: false });
        } while (again && !stopped);
      } finally {
        running = null;
        publish({ running: false });
        await refresh().catch(() => undefined);
      }
    })();
    return running;
  }

  return {
    run,
    idle: () => running ?? Promise.resolve(),
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async retryFailed() {
      await retryFailedCommands(db);
      await mediaQueue.retryFailed();
      feed.emit();
      await run('manual');
    },
    stop() {
      stopped = true;
      clearRetry();
      unsubscribeFeed();
    },
  };
}

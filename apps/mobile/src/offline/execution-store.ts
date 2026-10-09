import {
  type Answer,
  type Answers,
  deriveProblems,
  type DeviceInfo,
  EXECUTION_LIMITS,
  type ManualProblem,
  MEDIA_LIMITS,
  type MediaKind,
  mediaLimitFor,
  type MediaSource,
  type Missing,
  type RegisterMediaCommand,
  requirements,
} from '@taskop/contracts';
import type { ChangeFeed } from './change-feed';
import { type Clock, isClockTooFarAhead, readOffset } from './clock';
import { type ContentLoad, findItem, loadContent } from './content';
import type { Db } from './db';
import {
  type ExecutionRow,
  iso,
  type LocalExecution,
  type LocalMedia,
  type LocalOccurrence,
  type MediaRow,
  type OccurrenceRow,
  toExecution,
  toMedia,
  toOccurrence,
} from './local-model';
import { appendCommand } from './outbox';
import type { FileRemover } from './user-scope';

export type StartBlock = 'notYetOpen' | 'closed' | 'claimedByOther' | 'finished' | 'needsUpdate' | 'notDownloaded' | 'clockAhead';

const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'cancelled', 'audit_pending', 'audited']);

/**
 * Spec §7.4: start is offered when the window is open by device time, nobody else is known to hold the claim,
 * and the content is usable. Every occurrence on the phone came from /me/sync, which lists only the caller's
 * occurrences, so "I am an assignee" holds. The shift check runs on the server.
 *
 * Only asked when this phone has no execution of the occurrence (`start` resumes or refuses those itself). So any
 * known claim blocks, mine included: a claim of mine without a local execution is held by another install of mine,
 * and a second claim would only be rejected. It reads as `claimedByOther`, whose text names nobody.
 *
 * `offsetMs` is device minus server from the last /me/sync: a phone running too far ahead would send a start time
 * the server refuses.
 */
export function startBlock(o: LocalOccurrence, userId: string, now: number, content: ContentLoad['kind'], offsetMs = 0): StartBlock | null {
  if (FINISHED_STATUSES.has(o.status)) return 'finished';
  if (o.claim) return 'claimedByOther';
  if (isClockTooFarAhead(offsetMs)) return 'clockAhead';
  if (now < Date.parse(o.startsAt)) return 'notYetOpen';
  if (now >= Date.parse(o.closesAt)) return 'closed';
  if (content === 'missing') return 'notDownloaded';
  if (content === 'needsUpdate') return 'needsUpdate';
  return null;
}

export class ExecutionLockedError extends Error {
  constructor(readonly state: string) {
    super(`Execution is ${state}`);
    this.name = 'ExecutionLockedError';
  }
}

export class StartRefusedError extends Error {
  constructor(readonly reason: StartBlock) {
    super(`Cannot start: ${reason}`);
    this.name = 'StartRefusedError';
  }
}

export class MediaLimitError extends Error {
  constructor() {
    super('This item cannot take more media of this kind');
    this.name = 'MediaLimitError';
  }
}

export class LiveOnlyError extends Error {
  constructor() {
    super('This item accepts camera media only');
    this.name = 'LiveOnlyError';
  }
}

/** `claim` asks for an immediate sync (online starts claim at once); `change` waits 2 s for more edits. */
export type WriteKind = 'claim' | 'change';

export interface StoreDeps {
  db: Db;
  clock: Clock;
  newId: () => string;
  device: DeviceInfo;
  files: FileRemover;
  feed: ChangeFeed;
  onWrite: (kind: WriteKind) => void;
}

/** A photo or video already resized/recorded within MEDIA_LIMITS and stored under the app's documents. */
export interface CapturedMedia {
  kind: MediaKind;
  source: MediaSource;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  localUri: string;
  capturedAt: string;
}

/** Where a new medium goes: the item's photos/videos, or a manual problem being drafted (added by setProblem). */
export type MediaTarget = { itemId: string; field: 'evidence' } | { itemId: string; field: 'problem' };

export interface OccurrenceView extends LocalOccurrence {
  execution: LocalExecution | null;
}

/** The register-media body without `deviceTime`/`clientOffsetMs` (stamped at send). One builder for the outbox and the media queue. */
export type MediaRegisterBody = Omit<RegisterMediaCommand, 'deviceTime' | 'clientOffsetMs'>;

/**
 * The server binds a medium to its item: evidence media carry the item's id, media attached only to a manual
 * problem carry null (spec §5.2).
 */
export function mediaRegisterBody(m: Pick<LocalMedia, 'id' | 'itemId' | 'kind' | 'source' | 'mime' | 'bytes' | 'width' | 'height' | 'durationMs' | 'capturedAt'>): MediaRegisterBody {
  return {
    id: m.id, itemId: m.itemId, kind: m.kind, source: m.source, mime: m.mime, bytes: m.bytes,
    width: m.width, height: m.height, durationMs: m.durationMs, capturedAt: m.capturedAt,
  };
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

type Guard = { locked: true; state: string } | { locked: false; e: LocalExecution };

function compactAnswer(a: Answer): Answer | undefined {
  const out: Answer = {};
  if (a.optionIds?.length) out.optionIds = unique(a.optionIds);
  if (typeof a.number === 'number' && Number.isFinite(a.number)) out.number = a.number;
  if (a.text) out.text = a.text;
  if (a.datetime) out.datetime = a.datetime;
  // The server refuses a medium listed twice.
  if (a.photos?.length) out.photos = unique(a.photos);
  if (a.videos?.length) out.videos = unique(a.videos);
  if (a.note) out.note = a.note;
  if (a.problem) out.problem = { ...a.problem, mediaIds: unique(a.problem.mediaIds) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Answers as the API expects them: no empty fields, no empty answers. */
function compact(answers: Answers): Answers {
  const out: Answers = {};
  for (const [itemId, a] of Object.entries(answers)) {
    const c = a ? compactAnswer(a) : undefined;
    if (c) out[itemId] = c;
  }
  return out;
}

/** The answers without any reference to a medium (evidence photos/videos and problem media), compacted. */
export function withoutMedia(answers: Answers, mediaId: string): Answers {
  const out: Answers = {};
  for (const [itemId, a] of Object.entries(answers)) {
    if (!a) continue;
    out[itemId] = {
      ...a,
      photos: a.photos?.filter((x) => x !== mediaId),
      videos: a.videos?.filter((x) => x !== mediaId),
      problem: a.problem && { ...a.problem, mediaIds: a.problem.mediaIds.filter((x) => x !== mediaId) },
    };
  }
  return compact(out);
}

export function createExecutionStore(deps: StoreDeps) {
  const { db, clock, newId, device, files, feed, onWrite } = deps;
  const contents = new Map<string, ContentLoad>();

  const changed = (kind: WriteKind) => {
    feed.emit();
    onWrite(kind);
  };

  /** Pass `tx` when called inside a transaction. */
  async function content(versionId: string, q: Db = db): Promise<ContentLoad> {
    const cached = contents.get(versionId);
    if (cached) return cached;
    const row = await q.first<{ schema_version: number; content: string }>('SELECT schema_version, content FROM checklist_versions WHERE id = ?', [versionId]);
    if (!row) return { kind: 'missing' };
    const loaded = loadContent(row.schema_version, row.content);
    contents.set(versionId, loaded);
    return loaded;
  }

  async function usableContent(tx: Db, versionId: string) {
    const loaded = await content(versionId, tx);
    if (loaded.kind !== 'ok') throw new Error(`Checklist version ${versionId} cannot be used on this phone (${loaded.kind})`);
    return loaded.content;
  }

  /** Spec §7.4: past closes_at an open execution locks as partial. Persisted, so a clock moved back does not reopen it. */
  async function guard(tx: Db, executionId: string, now: number): Promise<Guard> {
    const row = await tx.first<ExecutionRow & { closes_at: string }>(
      'SELECT e.*, o.closes_at FROM executions e JOIN occurrences o ON o.id = e.occurrence_id WHERE e.id = ?',
      [executionId],
    );
    if (!row) throw new Error(`Unknown execution ${executionId}`);
    if (row.state !== 'active') return { locked: true, state: row.state };
    if (now >= Date.parse(row.closes_at)) {
      await tx.run(`UPDATE executions SET state = 'partial', locked_at = ?, updated_at = ? WHERE id = ?`, [iso(now), iso(now), executionId]);
      return { locked: true, state: 'partial' };
    }
    return { locked: false, e: toExecution(row) };
  }

  /**
   * One transaction: guard, then `edit` (which may write media rows and commands), then the new answers revision
   * and its outbox command. `edit` returns null when the answers do not change.
   */
  async function change(executionId: string, edit: (tx: Db, e: LocalExecution, now: number) => Promise<Answers | null>): Promise<void> {
    const now = clock.now();
    const result = await db.transaction(async (tx): Promise<Guard> => {
      const g = await guard(tx, executionId, now);
      if (g.locked) return g;
      const next = await edit(tx, g.e, now);
      if (next !== null) {
        const answers = compact(next);
        const rev = g.e.rev + 1;
        await tx.run('UPDATE executions SET answers = ?, rev = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), rev, iso(now), executionId]);
        await appendCommand(tx, { executionId, kind: 'answers', rev, payload: { rev, answers }, createdAt: iso(now) });
      }
      return g;
    });
    changed('change');
    if (result.locked) throw new ExecutionLockedError(result.state);
  }

  async function start(occurrenceId: string, userId: string): Promise<string> {
    const now = clock.now();
    const id = await db.transaction(async (tx) => {
      const mine = await tx.first<{ id: string; state: string }>(
        'SELECT id, state FROM executions WHERE occurrence_id = ? ORDER BY started_at DESC LIMIT 1',
        [occurrenceId],
      );
      if (mine?.state === 'active') return mine.id; // a double tap resumes instead of claiming twice
      if (mine) throw new StartRefusedError(mine.state === 'rejected' ? 'claimedByOther' : 'finished');
      const row = await tx.first<OccurrenceRow>('SELECT * FROM occurrences WHERE id = ?', [occurrenceId]);
      if (!row) throw new Error(`Unknown occurrence ${occurrenceId}`);
      const occ = toOccurrence(row);
      const block = startBlock(occ, userId, now, (await content(occ.checklistVersionId, tx)).kind, await readOffset(tx));
      if (block) throw new StartRefusedError(block);
      const executionId = newId();
      const startedAt = iso(now);
      await tx.run(
        `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES (?, ?, ?, 'active', 'pending', ?, ?)`,
        [executionId, occurrenceId, occ.checklistVersionId, startedAt, startedAt],
      );
      await appendCommand(tx, { executionId, kind: 'claim', createdAt: startedAt, payload: { id: executionId, occurrenceId, startedAt, device } });
      return executionId;
    });
    changed('claim');
    return id;
  }

  function patchAnswer(executionId: string, itemId: string, patch: Partial<Answer>): Promise<void> {
    return change(executionId, async (_tx, e) => ({ ...e.answers, [itemId]: { ...e.answers[itemId], ...patch } }));
  }

  async function setProblem(executionId: string, itemId: string, problem: ManualProblem | null): Promise<void> {
    let value: ManualProblem | undefined;
    if (problem) {
      const note = problem.note.trim();
      const mediaIds = unique(problem.mediaIds);
      if (!note || note.length > EXECUTION_LIMITS.problemNote || mediaIds.length > MEDIA_LIMITS.problemMaxMedia) {
        throw new RangeError('A manual problem needs a note of 1–2000 characters and at most 5 media');
      }
      value = { severity: problem.severity, note, mediaIds };
    }
    await change(executionId, async (tx, e) => {
      // A medium the sync engine dropped meanwhile (refused by the server) must not be sent: the API refuses unknown media.
      let problem = value;
      if (problem && problem.mediaIds.length > 0) {
        const known = await tx.all<{ id: string }>('SELECT id FROM media WHERE execution_id = ? AND id IN (SELECT value FROM json_each(?))', [
          executionId, JSON.stringify(problem.mediaIds),
        ]);
        const ids = new Set(known.map((r) => r.id));
        problem = { ...problem, mediaIds: problem.mediaIds.filter((m) => ids.has(m)) };
      }
      return { ...e.answers, [itemId]: { ...e.answers[itemId], problem } };
    });
  }

  async function attachMedia(executionId: string, m: CapturedMedia, target: MediaTarget): Promise<string> {
    const mediaId = newId();
    await change(executionId, async (tx, e, now) => {
      const item = findItem(await usableContent(tx, e.checklistVersionId), target.itemId);
      if (!item) throw new Error(`Unknown item ${target.itemId}`);
      if (item.evidence.liveOnly && m.source === 'gallery') throw new LiveOnlyError();
      const current = (m.kind === 'photo' ? e.answers[target.itemId]?.photos : e.answers[target.itemId]?.videos) ?? [];
      if (target.field === 'evidence' && current.length >= mediaLimitFor(item, m.kind)) throw new MediaLimitError();
      const itemId = target.field === 'evidence' ? target.itemId : null;
      await tx.run(
        `INSERT INTO media (id, execution_id, item_id, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mediaId, executionId, itemId, m.kind, m.source, m.mime, m.bytes, m.width, m.height, m.durationMs, m.capturedAt, m.localUri],
      );
      // Registration is queued before any answers that reference the medium (Part 1 decision 1).
      const body = mediaRegisterBody({ ...m, id: mediaId, itemId });
      await appendCommand(tx, { executionId, kind: 'media', refId: mediaId, createdAt: iso(now), payload: body });
      if (target.field === 'problem') return null;
      const next: Answer = { ...e.answers[target.itemId] };
      if (m.kind === 'photo') next.photos = [...current, mediaId];
      else next.videos = [...current, mediaId];
      return { ...e.answers, [target.itemId]: next };
    });
    return mediaId;
  }

  async function removeMedia(executionId: string, mediaId: string): Promise<void> {
    const discarded: string[] = [];
    await change(executionId, async (tx, e) => {
      const row = await tx.first<MediaRow>('SELECT * FROM media WHERE id = ? AND execution_id = ?', [mediaId, executionId]);
      if (row && row.registered_at === null) {
        // Never registered on the server: forget it entirely.
        await tx.run(`DELETE FROM outbox WHERE kind = 'media' AND ref_id = ?`, [mediaId]);
        await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
        discarded.push(row.local_uri);
      }
      return withoutMedia(e.answers, mediaId);
    });
    for (const uri of discarded) files.remove(uri);
  }

  async function complete(executionId: string): Promise<{ ok: true } | { ok: false; missing: Missing[] }> {
    const now = clock.now();
    type Outcome = { kind: 'locked'; state: string } | { kind: 'missing'; missing: Missing[] } | { kind: 'done' };
    const out = await db.transaction(async (tx): Promise<Outcome> => {
      const g = await guard(tx, executionId, now);
      if (g.locked) return { kind: 'locked', state: g.state };
      const missing = requirements(await usableContent(tx, g.e.checklistVersionId), g.e.answers);
      if (missing.length) return { kind: 'missing', missing };
      // A clock moved backwards must not put the completion before the start.
      const completedAt = iso(Math.max(now, Date.parse(g.e.startedAt)));
      // completeCommandSchema needs rev ≥ 1; the server ignores a revision it already has (Part 1 decision 2).
      const rev = Math.max(g.e.rev, 1);
      await tx.run(`UPDATE executions SET state = 'completed', completed_at = ?, rev = ?, updated_at = ? WHERE id = ?`, [completedAt, rev, iso(now), executionId]);
      await appendCommand(tx, { executionId, kind: 'complete', rev, payload: { rev, answers: g.e.answers, completedAt }, createdAt: iso(now) });
      return { kind: 'done' };
    });
    changed('change');
    if (out.kind === 'locked') throw new ExecutionLockedError(out.state);
    return out.kind === 'missing' ? { ok: false, missing: out.missing } : { ok: true };
  }

  /** Runs before each sync and on screen ticks: open executions past closes_at become partial locally. */
  async function lockExpired(): Promise<number> {
    const now = iso(clock.now());
    const n = await db.run(
      `UPDATE executions SET state = 'partial', locked_at = ?, updated_at = ?
       WHERE state = 'active' AND occurrence_id IN (SELECT id FROM occurrences WHERE closes_at <= ?)`,
      [now, now, now],
    );
    if (n > 0) feed.emit();
    return n;
  }

  return {
    content: (versionId: string) => content(versionId),
    async occurrences(): Promise<OccurrenceView[]> {
      const rows = await db.all<OccurrenceRow>('SELECT * FROM occurrences ORDER BY starts_at, checklist_name');
      const executions = await db.all<ExecutionRow>('SELECT * FROM executions ORDER BY started_at');
      const byOccurrence = new Map(executions.map((r) => [r.occurrence_id, toExecution(r)])); // the newest wins
      return rows.map((r) => ({ ...toOccurrence(r), execution: byOccurrence.get(r.id) ?? null }));
    },
    async occurrence(id: string): Promise<LocalOccurrence | null> {
      const row = await db.first<OccurrenceRow>('SELECT * FROM occurrences WHERE id = ?', [id]);
      return row ? toOccurrence(row) : null;
    },
    async execution(id: string): Promise<LocalExecution | null> {
      const row = await db.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [id]);
      return row ? toExecution(row) : null;
    },
    async media(executionId: string): Promise<LocalMedia[]> {
      return (await db.all<MediaRow>('SELECT * FROM media WHERE execution_id = ? ORDER BY captured_at, id', [executionId])).map(toMedia);
    },
    /** Commands not yet accepted plus registered files not yet uploaded (the logout warning, spec §7.4). */
    async unsyncedCount(): Promise<number> {
      const row = await db.first<{ n: number }>(
        `SELECT (SELECT count(*) FROM outbox)
              + (SELECT count(*) FROM media WHERE registered_at IS NOT NULL AND uploaded_at IS NULL AND file_deleted_at IS NULL) AS n`,
      );
      return row?.n ?? 0;
    },
    async problemCount(executionIds: string[]): Promise<number> {
      let n = 0;
      for (const id of executionIds) {
        const row = await db.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [id]);
        if (!row) continue;
        const loaded = await content(row.checklist_version_id);
        if (loaded.kind === 'ok') n += deriveProblems(loaded.content, toExecution(row).answers).length;
      }
      return n;
    },
    start,
    patchAnswer,
    setProblem,
    attachMedia,
    removeMedia,
    complete,
    lockExpired,
  };
}

export type ExecutionStore = ReturnType<typeof createExecutionStore>;

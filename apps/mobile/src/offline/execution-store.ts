import {
  type Answer,
  type Answers,
  type ChecklistContent,
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
  reworkViolations,
  visibleItems,
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

/** A run sent back for correction is not open to a new claim: its executor resumes their own execution (spec §3.1). */
const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'cancelled', 'audit_pending', 'audited', 'correction_required']);

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

/** An edit outside the items the manager sent back (spec §8.1); the server would refuse it with ITEM_NOT_IN_REWORK. */
export class ItemNotInReworkError extends Error {
  constructor(readonly itemIds: string[]) {
    super(`Not sent back for correction: ${itemIds.join(', ')}`);
    this.name = 'ItemNotInReworkError';
  }
}

/** The items the manager sent back: those of the open request. */
export const flaggedItems = (e: Pick<LocalExecution, 'rework'>): ReadonlySet<string> => new Set(e.rework?.items.map((i) => i.itemId) ?? []);

/**
 * Spec decision 2: what a run in rework offers for editing now. The flagged items, and every item visible now that was
 * not visible in the round's starting answers (follow-ups a flagged change revealed, chains included).
 */
export function reworkEditable(content: ChecklistContent, e: Pick<LocalExecution, 'rework' | 'answers'>): ReadonlySet<string> {
  const editable = new Set(flaggedItems(e));
  const before = new Set(visibleItems(content, e.rework?.answersBefore ?? e.answers).map((v) => v.item.id));
  for (const v of visibleItems(content, e.answers)) if (!before.has(v.item.id)) editable.add(v.item.id);
  return editable;
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
  /** The execution still has commands on the phone (waiting or failed). */
  unsynced: boolean;
}

/** A medium the server refused for good (or the worker discarded after it failed), shown on its item until a new one is attached. */
export interface MediaRefusal {
  mediaId: string;
  itemId: string | null;
  errorKey: string;
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
    // Spec §3.2: a run sent back for correction is not limited by closes_at.
    if (row.state === 'rework') return { locked: false, e: toExecution(row) };
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
        // The API's own rule (Part 1 `reworkViolations`), checked against the round's starting answers: throwing here
        // rolls back the whole edit, media rows included.
        if (g.e.state === 'rework') {
          const content = await usableContent(tx, g.e.checklistVersionId);
          const outside = reworkViolations(content, g.e.rework?.answersBefore ?? g.e.answers, answers, flaggedItems(g.e));
          if (outside.length > 0) throw new ItemNotInReworkError(outside);
        }
        const rev = g.e.rev + 1;
        await tx.run('UPDATE executions SET answers = ?, rev = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), rev, iso(now), executionId]);
        await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'answers', rev, payload: { rev, answers }, createdAt: iso(now) });
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
      // A double tap resumes instead of claiming twice; a run sent back to me resumes too.
      if (mine?.state === 'active' || mine?.state === 'rework') return mine.id;
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
      await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'claim', createdAt: startedAt, payload: { id: executionId, occurrenceId, startedAt, device } });
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
        const known = await tx.all<{ id: string }>(`SELECT id FROM media WHERE owner_type = 'execution' AND owner_id = ? AND id IN (SELECT value FROM json_each(?))`, [
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
      const content = await usableContent(tx, e.checklistVersionId);
      // A problem medium changes no answer until the problem is saved, so the answers check alone would miss it.
      if (e.state === 'rework' && !reworkEditable(content, e).has(target.itemId)) throw new ItemNotInReworkError([target.itemId]);
      const item = findItem(content, target.itemId);
      if (!item) throw new Error(`Unknown item ${target.itemId}`);
      if (item.evidence.liveOnly && m.source === 'gallery') throw new LiveOnlyError();
      const current = (m.kind === 'photo' ? e.answers[target.itemId]?.photos : e.answers[target.itemId]?.videos) ?? [];
      if (target.field === 'evidence' && current.length >= mediaLimitFor(item, m.kind)) throw new MediaLimitError();
      const itemId = target.field === 'evidence' ? target.itemId : null;
      // A new medium on the item replaces the note about one the server refused there.
      await tx.run(`DELETE FROM media_refusals WHERE owner_type = 'execution' AND owner_id = ? AND item_id = ?`, [executionId, target.itemId]);
      await tx.run(
        `INSERT INTO media (id, owner_type, owner_id, item_id, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
         VALUES (?, 'execution', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mediaId, executionId, itemId, m.kind, m.source, m.mime, m.bytes, m.width, m.height, m.durationMs, m.capturedAt, m.localUri],
      );
      // Registration is queued before any answers that reference the medium (Part 1 decision 1).
      const body = mediaRegisterBody({ ...m, id: mediaId, itemId });
      await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'media', refId: mediaId, createdAt: iso(now), payload: body });
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
      const row = await tx.first<MediaRow>(`SELECT * FROM media WHERE id = ? AND owner_type = 'execution' AND owner_id = ?`, [mediaId, executionId]);
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
      await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'complete', rev, payload: { rev, answers: g.e.answers, completedAt }, createdAt: iso(now) });
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
      const queued = new Set((await db.all<{ entity_id: string }>(`SELECT DISTINCT entity_id FROM outbox WHERE entity_type = 'execution'`)).map((r) => r.entity_id));
      return rows.map((r) => {
        const execution = byOccurrence.get(r.id) ?? null;
        return { ...toOccurrence(r), execution, unsynced: execution !== null && queued.has(execution.id) };
      });
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
      return (await db.all<MediaRow>(`SELECT * FROM media WHERE owner_type = 'execution' AND owner_id = ? ORDER BY captured_at, id`, [executionId])).map(toMedia);
    },
    async mediaRefusals(executionId: string): Promise<MediaRefusal[]> {
      const rows = await db.all<{ media_id: string; item_id: string | null; error_key: string }>(
        `SELECT media_id, item_id, error_key FROM media_refusals WHERE owner_type = 'execution' AND owner_id = ? ORDER BY created_at, media_id`,
        [executionId],
      );
      return rows.map((r) => ({ mediaId: r.media_id, itemId: r.item_id, errorKey: r.error_key }));
    },
    /** Commands not yet accepted, registered files not yet uploaded, and task responses typed or photographed but not submitted (the logout warning, spec §7.4). */
    async unsyncedCount(): Promise<number> {
      const row = await db.first<{ n: number }>(
        `SELECT (SELECT count(*) FROM outbox)
              + (SELECT count(*) FROM media WHERE registered_at IS NOT NULL AND uploaded_at IS NULL AND file_deleted_at IS NULL)
              + (SELECT count(*) FROM task_drafts WHERE submitted_at IS NULL AND (text <> '' OR media_ids <> '[]')) AS n`,
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

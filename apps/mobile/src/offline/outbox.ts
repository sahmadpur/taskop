import type { Db } from './db';

export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** What a command or a medium belongs to (local database version 3). */
export const ENTITY_TYPES = ['execution', 'task'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

interface OutboxRow {
  seq: number;
  entity_type: EntityType;
  entity_id: string;
  kind: CommandKind;
  ref_id: string | null;
  rev: number | null;
  payload: string;
  status: 'pending' | 'failed';
  attempts: number;
  error_code: string | null;
  error_key: string | null;
  created_at: string;
}

export interface OutboxCommand {
  seq: number;
  entityType: EntityType;
  /** The execution or task the command belongs to. */
  entityId: string;
  kind: CommandKind;
  /** The medium ID of a media registration; the submission ID of a task submission. */
  refId: string | null;
  rev: number | null;
  /** The command body. Execution commands get `deviceTime` (= `createdAt`) and `clientOffsetMs` stamped when sent. */
  payload: Record<string, unknown>;
  status: 'pending' | 'failed';
  attempts: number;
  errorCode: string | null;
  errorKey: string | null;
  /** The device time of the worker's action. A newer answers revision carries its own action time. */
  createdAt: string;
}

const toCommand = (r: OutboxRow): OutboxCommand => ({
  seq: r.seq,
  entityType: r.entity_type,
  entityId: r.entity_id,
  kind: r.kind,
  refId: r.ref_id,
  rev: r.rev,
  payload: JSON.parse(r.payload) as Record<string, unknown>,
  status: r.status,
  attempts: r.attempts,
  errorCode: r.error_code,
  errorKey: r.error_key,
  createdAt: r.created_at,
});

export interface AppendInput {
  entityType: EntityType;
  entityId: string;
  kind: CommandKind;
  refId?: string | null;
  rev?: number | null;
  payload: Record<string, unknown>;
  /** When the worker acted (device time), not when the command is sent. */
  createdAt: string;
}

/** Called inside the action's transaction. Only the newest answers revision is ever sent (SP4 spec §7.2). */
export async function appendCommand(tx: Db, c: AppendInput): Promise<void> {
  if (c.kind === 'answers') await tx.run(`DELETE FROM outbox WHERE entity_type = ? AND entity_id = ? AND kind = 'answers'`, [c.entityType, c.entityId]);
  await tx.run('INSERT INTO outbox (entity_type, entity_id, kind, ref_id, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    c.entityType,
    c.entityId,
    c.kind,
    c.refId ?? null,
    c.rev ?? null,
    JSON.stringify(c.payload),
    c.createdAt,
  ]);
}

/** The oldest pending command. Commands of an execution whose claim failed wait: without the claim they could only fail. */
export async function nextCommand(db: Db): Promise<OutboxCommand | null> {
  const row = await db.first<OutboxRow>(
    `SELECT * FROM outbox o
     WHERE o.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM outbox c WHERE c.entity_type = o.entity_type AND c.entity_id = o.entity_id AND c.kind = 'claim' AND c.status = 'failed')
     ORDER BY o.seq LIMIT 1`,
  );
  return row ? toCommand(row) : null;
}

export const ackCommand = (db: Db, seq: number) => db.run('DELETE FROM outbox WHERE seq = ?', [seq]);

export const failCommand = (db: Db, seq: number, code: string, messageKey: string) =>
  db.run(`UPDATE outbox SET status = 'failed', attempts = attempts + 1, error_code = ?, error_key = ? WHERE seq = ?`, [code, messageKey, seq]);

export const noteAttempt = (db: Db, seq: number) => db.run('UPDATE outbox SET attempts = attempts + 1 WHERE seq = ?', [seq]);

export const retryFailedCommands = (db: Db) =>
  db.run(`UPDATE outbox SET status = 'pending', error_code = NULL, error_key = NULL WHERE status = 'failed'`);

export interface OutboxCounts {
  pending: number;
  failed: number;
}

export async function outboxCounts(db: Db): Promise<OutboxCounts> {
  const rows = await db.all<{ status: 'pending' | 'failed'; n: number }>('SELECT status, count(*) AS n FROM outbox GROUP BY status');
  return { pending: rows.find((r) => r.status === 'pending')?.n ?? 0, failed: rows.find((r) => r.status === 'failed')?.n ?? 0 };
}

export interface QueueEntry extends OutboxCommand {
  /** The checklist or task the command belongs to, for the sync queue; null once it is gone from the phone. */
  title: string | null;
}

export async function listCommands(db: Db): Promise<QueueEntry[]> {
  const rows = await db.all<OutboxRow & { title: string | null }>(
    `SELECT o.*, coalesce(oc.checklist_name, json_extract(t.data, '$.title')) AS title FROM outbox o
     LEFT JOIN executions e ON o.entity_type = 'execution' AND e.id = o.entity_id
     LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
     LEFT JOIN tasks t ON o.entity_type = 'task' AND t.id = o.entity_id
     ORDER BY o.seq`,
  );
  return rows.map((r) => ({ ...toCommand(r), title: r.title }));
}

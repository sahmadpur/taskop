import type { Db } from './db';

export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

interface OutboxRow {
  seq: number;
  execution_id: string;
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
  executionId: string;
  kind: CommandKind;
  /** The medium ID for `media` commands. */
  refId: string | null;
  rev: number | null;
  /** The command body without `deviceTime` and `clientOffsetMs`. `clientOffsetMs` is stamped when it is sent; `deviceTime` is `createdAt`. */
  payload: Record<string, unknown>;
  status: 'pending' | 'failed';
  attempts: number;
  errorCode: string | null;
  errorKey: string | null;
  /** The device time of the worker's action. It is the command's `deviceTime`; a newer answers revision carries its own action time. */
  createdAt: string;
}

const toCommand = (r: OutboxRow): OutboxCommand => ({
  seq: r.seq,
  executionId: r.execution_id,
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
  executionId: string;
  kind: CommandKind;
  refId?: string | null;
  rev?: number | null;
  payload: Record<string, unknown>;
  /** When the worker acted (device time), not when the command is sent. */
  createdAt: string;
}

/** Called inside the action's transaction. Only the newest answers revision is ever sent (spec §7.2). */
export async function appendCommand(tx: Db, c: AppendInput): Promise<void> {
  if (c.kind === 'answers') await tx.run(`DELETE FROM outbox WHERE execution_id = ? AND kind = 'answers'`, [c.executionId]);
  await tx.run('INSERT INTO outbox (execution_id, kind, ref_id, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    c.executionId,
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
       AND NOT EXISTS (SELECT 1 FROM outbox c WHERE c.execution_id = o.execution_id AND c.kind = 'claim' AND c.status = 'failed')
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
  checklistName: string | null;
}

export async function listCommands(db: Db): Promise<QueueEntry[]> {
  const rows = await db.all<OutboxRow & { checklist_name: string | null }>(
    `SELECT o.*, oc.checklist_name FROM outbox o
     LEFT JOIN executions e ON e.id = o.execution_id
     LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
     ORDER BY o.seq`,
  );
  return rows.map((r) => ({ ...toCommand(r), checklistName: r.checklist_name }));
}

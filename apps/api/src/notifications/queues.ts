import pg from 'pg';

/** SP6 spec §6.3. */
export const NOTIFICATION_QUEUES = {
  fanout: 'notifications.fanout',
  deliver: 'notifications.deliver',
  scan: 'notifications.scan',
  receipts: 'notifications.receipts',
  sweep: 'notifications.sweep',
  cleanup: 'notifications.cleanup',
  dead: 'notifications.dead',
} as const;

export const NOTIFICATION_LIMITS = {
  /** Per event and per delivery (spec §6.1, NFR-11.03). */
  maxAttempts: 5,
  /** Push deliveries per notifications.deliver job (one Expo request). */
  pushBatch: 100,
  /** checklist.available only for occurrences that opened this recently (spec §3.4). */
  availableWindowMinutes: 15,
  /** notifications.receipts reads receipts for pushes sent at least this long ago… */
  receiptDelayMinutes: 15,
  /** …and at most this long ago (Expo keeps receipts for 24 h; Spec decision 10). */
  receiptMaxAgeHours: 24,
  /** notifications.sweep re-sends fan-out for events unprocessed this long… */
  fanoutStaleMinutes: 2,
  /** …and delivery for rows queued this long. */
  deliverStaleMinutes: 5,
  /** notifications.cleanup deletes notifications and processed events older than this… */
  retentionDays: 90,
  /** …and disables devices not seen for this long. */
  deviceIdleDays: 180,
} as const;

export interface FanoutJob {
  tenantId: string;
  eventId: string;
}

export interface DeliverJob {
  tenantId: string;
  /** ≤ 100 push deliveries, or one email delivery. */
  deliveryIds: string[];
}

interface PgDatabaseError {
  code: string;
  constraint?: string;
}

/**
 * A real Postgres error, as node-postgres raises it: a DatabaseError, or an object carrying the fields it sets from the
 * server's ErrorResponse (severity, a 5-character SQLSTATE and the source routine/file). A bare 5-character `code`
 * is not enough: Node, system and SMTP errors (EAUTH, EPIPE, ECONNRESET) have one too.
 */
function postgresErrorOf(e: unknown): PgDatabaseError | null {
  let current: unknown = e;
  // Drizzle wraps the driver error as `cause`.
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const c = current as { code?: unknown; severity?: unknown; routine?: unknown; file?: unknown; cause?: unknown };
    if (current instanceof pg.DatabaseError) return c as PgDatabaseError;
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code) && typeof c.severity === 'string' && (typeof c.routine === 'string' || typeof c.file === 'string')) return c as PgDatabaseError;
    current = c.cause;
  }
  return null;
}

/** The text stored in last_error: never a driver error's SQL or parameters (see sanitiseForLog). At most 500 characters. */
export function failureText(e: unknown): string {
  const pgError = postgresErrorOf(e);
  if (pgError) return `Database error ${pgError.code}${pgError.constraint ? ` (${pgError.constraint})` : ''}`.slice(0, 500);
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith('Failed query:')) return 'Database error';
  return message.slice(0, 500);
}

import { sql } from 'drizzle-orm';

/** Media of the execution in the current row not yet confirmed as uploaded (spec §6.7 `mediaPending`). */
export const mediaPendingSql = sql<number>`(select count(*)::int from execution_media m where m.execution_id = "executions"."id" and m.status = 'pending')`;

import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { myExecutionSchema, syncChecklistVersionSchema, syncOccurrenceSchema } from './execution-views.js';
import { syncTaskSchema } from './task-views.js';
import { TASK_LIMITS } from './tasks.js';

const splitIds = (s: string | undefined) => (s ? s.split(',').filter(Boolean) : []);

/** `a,b` in the query string; more than `max` ids fail the request. */
const idList = (max: number) => z.string().optional().transform(splitIds).pipe(z.array(idSchema).max(max));

/** `a,b` in the query string; ids beyond the first `max` are dropped (spec R20), so an old client never loses its whole sync. */
const idListTruncated = (max: number) =>
  z
    .string()
    .optional()
    .transform((s) => splitIds(s).slice(0, max))
    .pipe(z.array(idSchema));

export const syncQuerySchema = z.object({
  /** Checklist versions the phone already holds. */
  knownVersionIds: idList(200),
  /** Tasks the phone holds; those no longer in `tasks` come back in `removedTaskIds` (spec §6.4). Only the first TASK_LIMITS.knownTaskIds are read. */
  knownTaskIds: idListTruncated(TASK_LIMITS.knownTaskIds),
});
export type SyncQuery = z.input<typeof syncQuerySchema>;

export const syncResponseSchema = z.object({
  serverTime: isoDateTimeSchema,
  occurrences: z.array(syncOccurrenceSchema),
  checklistVersions: z.array(syncChecklistVersionSchema),
  executions: z.array(myExecutionSchema),
  /** The complete current set: open tasks of the user, unaccepted team tasks, and tasks closed in the last 7 days. */
  tasks: z.array(syncTaskSchema),
  removedTaskIds: z.array(idSchema),
  /** The caller's unread inbox rows (spec §4); the phone sets its app-icon badge from it. */
  unreadNotifications: z.number().int().min(0),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

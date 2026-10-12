import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { myExecutionSchema, syncChecklistVersionSchema, syncOccurrenceSchema } from './execution-views.js';
import { syncTaskSchema } from './task-views.js';
import { TASK_LIMITS } from './tasks.js';

/** `a,b` in the query string. */
const idList = (max: number) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(idSchema).max(max));

export const syncQuerySchema = z.object({
  /** Checklist versions the phone already holds. */
  knownVersionIds: idList(200),
  /** Tasks the phone holds; those no longer in `tasks` come back in `removedTaskIds` (spec §6.4). */
  knownTaskIds: idList(TASK_LIMITS.knownTaskIds),
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
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

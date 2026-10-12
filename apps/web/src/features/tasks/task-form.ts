import {
  type CreateTaskInput,
  DEFAULT_TASK_EVIDENCE,
  type ProblemDto,
  TASK_LIMITS,
  type TaskAssignee,
  type TaskDetail,
  type TaskEvidence,
  type TaskPriority,
  type UpdateTaskInput,
} from '@taskop/contracts';
import { type AssigneeChoice, dueAtFromLocal, localDueParts, sameChoice } from './labels';

export interface TaskFormValues {
  title: string;
  instructions: string;
  priority: TaskPriority;
  assignee: AssigneeChoice | null;
  siteId: string;
  /** Tenant-local YYYY-MM-DD and HH:MM, or ''. */
  dueDate: string;
  dueTime: string;
  requiresReview: boolean;
  evidence: TaskEvidence;
}

/** i18n keys per field. */
export type TaskFormErrors = Partial<Record<'title' | 'assignee' | 'dueDate', string>>;

const EVIDENCE_KEYS = ['photo', 'video', 'liveOnly'] as const;

/** The picker's value for a task: its person if someone holds it, else its team. */
export const choiceOf = (t: Pick<TaskDetail, 'assignee' | 'team'>): AssigneeChoice | null =>
  t.assignee ? { type: 'user', id: t.assignee.id, name: t.assignee.fullName } : t.team ? { type: 'team', id: t.team.id, name: t.team.name } : null;

export const toAssignee = (c: AssigneeChoice): TaskAssignee => (c.type === 'user' ? { userId: c.id } : { teamId: c.id });

/** Spec §8 pre-fill from a problem: title = item label, instructions = note, high for critical, review on. */
export function initialValues(source: { task?: TaskDetail; problem?: ProblemDto }, timeZone: string): TaskFormValues {
  const { task, problem } = source;
  if (task) {
    const due = localDueParts(task.dueAt, timeZone);
    return {
      title: task.title,
      instructions: task.instructions,
      priority: task.priority,
      assignee: choiceOf(task),
      siteId: task.site?.id ?? '',
      dueDate: due.date,
      dueTime: due.time,
      requiresReview: task.requiresReview,
      evidence: { ...task.evidence },
    };
  }
  return {
    title: problem?.itemLabel ?? '',
    instructions: problem?.note ?? '',
    priority: problem?.severity === 'critical' ? 'high' : 'normal',
    assignee: null,
    siteId: problem?.siteId ?? '',
    dueDate: '',
    dueTime: '',
    requiresReview: Boolean(problem),
    evidence: { ...DEFAULT_TASK_EVIDENCE },
  };
}

export function formErrors(v: TaskFormValues): TaskFormErrors {
  const errors: TaskFormErrors = {};
  const title = v.title.trim();
  if (!title) errors.title = 'errors.validation.required';
  else if (title.length > TASK_LIMITS.titleMax) errors.title = 'errors.validation.tooLong';
  if (!v.assignee) errors.assignee = 'errors.validation.required';
  if (v.dueTime && !v.dueDate) errors.dueDate = 'tasks.dialog.dateRequired';
  return errors;
}

/** API field errors (i18n keys) on the dialog's fields. */
export const fieldErrors = (fields: Record<string, string>): TaskFormErrors => ({
  ...(fields.title ? { title: fields.title } : {}),
  ...(fields.assignee ? { assignee: fields.assignee } : {}),
  ...(fields.dueAt ? { dueDate: fields.dueAt } : {}),
});

/** POST /tasks. A problem's site is the API's to take (Part 1 decision 19), so none is sent with one. */
export function createBody(id: string, v: TaskFormValues, timeZone: string, problem?: ProblemDto): CreateTaskInput {
  return {
    id,
    title: v.title.trim(),
    instructions: v.instructions.trim(),
    priority: v.priority,
    siteId: problem ? null : v.siteId || null,
    dueAt: dueAtFromLocal(v.dueDate, v.dueTime, timeZone),
    evidence: v.evidence,
    requiresReview: v.requiresReview,
    assignee: toAssignee(v.assignee!),
    problemId: problem?.id ?? null,
  };
}

/**
 * PATCH /tasks/:id with only what changed: a stale form never overwrites someone else's edit, and the assignee is
 * sent (a reassign, back to `new`) only when another person or team was picked.
 */
export function changedFields(task: TaskDetail, v: TaskFormValues, timeZone: string): UpdateTaskInput {
  const before = initialValues({ task }, timeZone);
  const body: UpdateTaskInput = {};
  if (v.title.trim() !== before.title) body.title = v.title.trim();
  if (v.instructions.trim() !== before.instructions) body.instructions = v.instructions.trim();
  if (v.priority !== before.priority) body.priority = v.priority;
  if (task.source === 'adhoc' && v.siteId !== before.siteId) body.siteId = v.siteId || null;
  if (v.dueDate !== before.dueDate || v.dueTime !== before.dueTime) body.dueAt = dueAtFromLocal(v.dueDate, v.dueTime, timeZone);
  if (v.requiresReview !== before.requiresReview) body.requiresReview = v.requiresReview;
  if (EVIDENCE_KEYS.some((k) => v.evidence[k] !== before.evidence[k])) body.evidence = v.evidence;
  if (v.assignee && !sameChoice(v.assignee, before.assignee)) body.assignee = toAssignee(v.assignee);
  return body;
}

import type { NotificationType } from '@taskop/contracts';

/** notification_events.payload holds ids only (spec §5), except for manual messages. */
export interface OccurrencePayload {
  occurrenceId: string;
}

export interface AssignedPayload {
  assignmentId: string;
  addedUserIds: string[];
}

export interface ProblemPayload {
  problemId: string;
  occurrenceId: string;
}

export interface TaskPayload {
  taskId: string;
}

/** The message as sent; recipients are expanded from the ids at fan-out (Spec decision 12). */
export interface ManualPayload {
  title: string;
  body: string;
  userIds: string[];
  teamIds: string[];
  siteIds: string[];
  email: boolean;
}

export interface PayloadOf extends Record<NotificationType, object> {
  'checklist.assigned': AssignedPayload;
  'checklist.available': OccurrencePayload;
  'checklist.due_soon': OccurrencePayload;
  'checklist.overdue': OccurrencePayload;
  'checklist.missed': OccurrencePayload;
  'problem.recorded': ProblemPayload;
  'problem.critical': ProblemPayload;
  'task.assigned': TaskPayload;
  'task.submitted': TaskPayload;
  'task.rejected': TaskPayload;
  'task.completed': TaskPayload;
  'task.overdue': TaskPayload;
  'task.cancelled': TaskPayload;
  manual: ManualPayload;
}

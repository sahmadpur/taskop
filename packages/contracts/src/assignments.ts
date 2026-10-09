import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { occurrenceDtoSchema, userRefSchema } from './occurrences.js';
import { localDateSchema } from './scheduling-time.js';
import { PREVIEW_WARNINGS, recurrenceSchema, SCHEDULING_LIMITS, timingSchema } from './scheduling.js';

export const ASSIGNMENT_STATUSES = ['active', 'paused', 'ended'] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const assignmentDtoSchema = z.object({
  id: idSchema,
  name: z.string().nullable(),
  checklistId: idSchema,
  checklistName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  schedule: recurrenceSchema,
  timing: timingSchema,
  shiftName: z.string().nullable(),
  status: assignmentStatusSchema,
  revision: z.number().int(),
  assignees: z.array(userRefSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AssignmentDto = z.infer<typeof assignmentDtoSchema>;

export const assignmentDetailSchema = assignmentDtoSchema.extend({
  /** The next 5 pending or overdue occurrences that have not closed yet. */
  upcoming: z.array(occurrenceDtoSchema),
});
export type AssignmentDetail = z.infer<typeof assignmentDetailSchema>;

const assignmentName = z.string().trim().max(200).nullable();
const assigneeIds = z.array(idSchema).min(1).max(SCHEDULING_LIMITS.maxAssignees);

export const createAssignmentInputSchema = z.object({
  name: assignmentName.optional(),
  checklistId: idSchema,
  siteId: idSchema,
  assigneeIds,
  schedule: recurrenceSchema,
  timing: timingSchema,
});
export type CreateAssignmentInput = z.input<typeof createAssignmentInputSchema>;

/** Checklist and site are fixed after creation; "Copy to other sites" makes a new assignment. */
export const updateAssignmentInputSchema = z.object({
  revision: z.number().int().min(1),
  name: assignmentName.optional(),
  assigneeIds: assigneeIds.optional(),
  schedule: recurrenceSchema.optional(),
  timing: timingSchema.optional(),
});
export type UpdateAssignmentInput = z.input<typeof updateAssignmentInputSchema>;

export const previewAssignmentInputSchema = z.object({
  siteId: idSchema,
  schedule: recurrenceSchema,
  timing: timingSchema,
  assigneeIds: z.array(idSchema).max(SCHEDULING_LIMITS.maxAssignees).optional(),
});
export type PreviewAssignmentInput = z.input<typeof previewAssignmentInputSchema>;

export const previewSlotSchema = z.object({ localDate: localDateSchema, startsAt: isoDateTimeSchema, dueAt: isoDateTimeSchema, closesAt: isoDateTimeSchema });
export type PreviewSlot = z.infer<typeof previewSlotSchema>;

export const assignmentPreviewSchema = z.object({ slots: z.array(previewSlotSchema), warnings: z.array(z.enum(PREVIEW_WARNINGS)) });
export type AssignmentPreview = z.infer<typeof assignmentPreviewSchema>;

export const assignmentListQuerySchema = cursorQuerySchema.extend({
  siteId: idSchema.optional(),
  checklistId: idSchema.optional(),
  status: assignmentStatusSchema.optional(),
  assigneeId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type AssignmentListQuery = z.input<typeof assignmentListQuerySchema>;

import { z } from 'zod';
import { checklistContentSchema, contentIssueSchema } from './checklist-content.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { templateCategorySchema } from './templates.js';

export const checklistStatusSchema = z.enum(['active', 'deactivated']);
export type ChecklistStatus = z.infer<typeof checklistStatusSchema>;
export const checklistVersionStateSchema = z.enum(['draft', 'published']);

export const checklistSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: templateCategorySchema.nullable(),
  status: checklistStatusSchema,
  /** null until the first publish. */
  currentVersionNumber: z.number().int().nullable(),
  /** Revision of the open draft, null when there is none. */
  draftRevision: z.number().int().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type ChecklistSummary = z.infer<typeof checklistSummarySchema>;

export const actorRefSchema = z.object({ kind: z.enum(['user', 'platform']), name: z.string().nullable() });
export type ActorRef = z.infer<typeof actorRefSchema>;

export const checklistVersionSummarySchema = z.object({
  id: idSchema,
  number: z.number().int().nullable(),
  state: checklistVersionStateSchema,
  changeNote: z.string().nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  publishedBy: actorRefSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ChecklistVersionSummary = z.infer<typeof checklistVersionSummarySchema>;

export const checklistSourceSchema = z.object({ kind: z.enum(['global', 'tenant', 'version']), id: idSchema });
export const checklistDetailSchema = checklistSummarySchema.extend({
  currentVersionId: idSchema.nullable(),
  source: checklistSourceSchema.nullable(),
  /** Draft first, then published versions newest first. */
  versions: z.array(checklistVersionSummarySchema),
});
export type ChecklistDetail = z.infer<typeof checklistDetailSchema>;

export const checklistVersionSchema = checklistVersionSummarySchema.extend({
  checklistId: idSchema,
  revision: z.number().int(),
  content: checklistContentSchema,
});
export type ChecklistVersion = z.infer<typeof checklistVersionSchema>;

export const contentSaveResultSchema = z.object({ revision: z.number().int(), issues: z.array(contentIssueSchema) });
export type ContentSaveResult = z.infer<typeof contentSaveResultSchema>;

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).nullable();

export const createChecklistInputSchema = z.object({
  name,
  description: description.optional(),
  category: templateCategorySchema.nullable().optional(),
  from: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('global'), templateId: idSchema }),
      z.object({ kind: z.literal('tenant'), templateId: idSchema }),
      z.object({ kind: z.literal('version'), versionId: idSchema }),
    ])
    .optional(),
});
export type CreateChecklistInput = z.input<typeof createChecklistInputSchema>;

export const updateChecklistInputSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  category: templateCategorySchema.nullable().optional(),
});
export type UpdateChecklistInput = z.input<typeof updateChecklistInputSchema>;

export const startDraftInputSchema = z.object({ fromVersionId: idSchema.optional() });
export type StartDraftInput = z.input<typeof startDraftInputSchema>;

/** `content` is parsed by the API with the draft schema, so errors come back as `issues`. */
export const saveContentInputSchema = z.object({ content: z.unknown(), revision: z.number().int().min(1) });
export type SaveContentInput = z.input<typeof saveContentInputSchema>;

export const publishInputSchema = z.object({
  revision: z.number().int().min(1),
  changeNote: z.string().trim().max(500).nullable().optional(),
});
export type PublishInput = z.input<typeof publishInputSchema>;

export const checklistListQuerySchema = cursorQuerySchema.extend({
  status: checklistStatusSchema.optional(),
  category: templateCategorySchema.optional(),
  q: z.string().trim().max(100).optional(),
  hasDraft: z.stringbool().optional(),
});
export type ChecklistListQuery = z.input<typeof checklistListQuerySchema>;

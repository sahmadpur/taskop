import { z } from 'zod';
import { checklistContentSchema } from './checklist-content.js';
import { idSchema, isoDateTimeSchema } from './common.js';

export const TEMPLATE_CATEGORIES = ['cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other'] as const;
export const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;
export const templateSourceSchema = z.enum(['global', 'tenant']);
export type TemplateSource = z.infer<typeof templateSourceSchema>;
const statusSchema = z.enum(['active', 'deactivated']);

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).nullable();

export const templateSummarySchema = z.object({
  id: idSchema,
  source: templateSourceSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: templateCategorySchema,
  status: statusSchema,
  itemCount: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type TemplateSummary = z.infer<typeof templateSummarySchema>;
export const templateSchema = templateSummarySchema.extend({ revision: z.number().int(), content: checklistContentSchema });
export type TemplateDto = z.infer<typeof templateSchema>;

export const globalTemplateSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: templateCategorySchema,
  published: z.boolean(),
  sortOrder: z.number().int(),
  itemCount: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type GlobalTemplateSummary = z.infer<typeof globalTemplateSummarySchema>;
export const globalTemplateSchema = globalTemplateSummarySchema.extend({ revision: z.number().int(), content: checklistContentSchema });
export type GlobalTemplateDto = z.infer<typeof globalTemplateSchema>;

export const templateListQuerySchema = z.object({
  source: templateSourceSchema.optional(),
  category: templateCategorySchema.optional(),
  status: statusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type TemplateListQuery = z.input<typeof templateListQuerySchema>;

export const createTemplateInputSchema = z.object({
  name,
  description: description.optional(),
  category: templateCategorySchema,
  /** Omitted → blank content. Validated with the draft schema by the API. */
  content: z.unknown().optional(),
});
export type CreateTemplateInput = z.input<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  category: templateCategorySchema.optional(),
});
export type UpdateTemplateInput = z.input<typeof updateTemplateInputSchema>;

export const updateGlobalTemplateInputSchema = updateTemplateInputSchema.extend({ sortOrder: z.number().int().min(0).max(10_000).optional() });
export type UpdateGlobalTemplateInput = z.input<typeof updateGlobalTemplateInputSchema>;

export const saveAsTemplateInputSchema = z.object({ name, description: description.optional(), category: templateCategorySchema });
export type SaveAsTemplateInput = z.input<typeof saveAsTemplateInputSchema>;

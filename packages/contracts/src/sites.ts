import { z } from 'zod';
import { idSchema } from './common.js';

export const siteTypeDtoSchema = z.object({ id: idSchema, name: z.string(), sortOrder: z.number().int(), active: z.boolean() });
export type SiteTypeDto = z.infer<typeof siteTypeDtoSchema>;

export const createSiteTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreateSiteTypeInput = z.input<typeof createSiteTypeInputSchema>;

export const updateSiteTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});
export type UpdateSiteTypeInput = z.input<typeof updateSiteTypeInputSchema>;

export const siteDtoSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  typeId: idSchema,
  name: z.string(),
  address: z.string().nullable(),
  active: z.boolean(),
  path: z.string(),
  depth: z.number().int(),
});
export type SiteDto = z.infer<typeof siteDtoSchema>;

export const createSiteInputSchema = z.object({
  parentId: idSchema.nullable(),
  typeId: idSchema,
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).nullable().optional(),
});
export type CreateSiteInput = z.input<typeof createSiteInputSchema>;

export const updateSiteInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  typeId: idSchema.optional(),
  address: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateSiteInput = z.input<typeof updateSiteInputSchema>;

export const moveSiteInputSchema = z.object({ parentId: idSchema.nullable() });
export type MoveSiteInput = z.input<typeof moveSiteInputSchema>;

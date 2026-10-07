import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';

export const platformLoginInputSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(128),
});
export type PlatformLoginInput = z.input<typeof platformLoginInputSchema>;

export const platformLoginResultSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  admin: z.object({ id: idSchema, email: z.string(), fullName: z.string() }),
});
export type PlatformLoginResult = z.infer<typeof platformLoginResultSchema>;

export const platformTenantDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  orgCode: z.string(),
  status: z.enum(['active', 'suspended']),
  userCount: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export type PlatformTenantDto = z.infer<typeof platformTenantDtoSchema>;

export const platformTenantListQuerySchema = cursorQuerySchema.extend({ q: z.string().trim().max(100).optional() });
export type PlatformTenantListQuery = z.input<typeof platformTenantListQuerySchema>;

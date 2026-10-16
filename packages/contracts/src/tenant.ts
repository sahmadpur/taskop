import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'errors.validation.timezone' },
);

/** The UI languages a user or tenant can choose; Azerbaijani is the source of truth. Mirrored by @taskop/i18n LANGUAGES. */
export const LOCALES = ['az', 'en', 'ru'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const tenantDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  orgCode: z.string(),
  timezone: z.string(),
  locale: z.string(),
  status: z.enum(['active', 'suspended']),
  createdAt: isoDateTimeSchema,
});
export type TenantDto = z.infer<typeof tenantDtoSchema>;

export const updateTenantInputSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: timezoneSchema.optional(),
});
export type UpdateTenantInput = z.input<typeof updateTenantInputSchema>;

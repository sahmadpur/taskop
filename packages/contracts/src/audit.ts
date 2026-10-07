import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';

export const auditEntryDtoSchema = z.object({
  id: idSchema,
  actor: z.object({
    type: z.enum(['user', 'platform_admin', 'system']),
    id: idSchema.nullable(),
    name: z.string().nullable(),
  }),
  action: z.string(),
  entityType: z.string(),
  entityId: idSchema.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type AuditEntryDto = z.infer<typeof auditEntryDtoSchema>;

export const auditListQuerySchema = cursorQuerySchema.extend({
  actorUserId: idSchema.optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(50).optional(),
  entityId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type AuditListQuery = z.input<typeof auditListQuerySchema>;

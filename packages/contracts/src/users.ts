import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { credentialKindSchema, emailSchema, secretSchemaFor, usernameSchema } from './credentials.js';
import { systemRoleKeySchema } from './permissions.js';

export const userStatusSchema = z.enum(['active', 'deactivated', 'invited']);
export const userKindSchema = z.enum(['worker', 'staff']);

export const userDtoSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  kind: userKindSchema,
  email: z.string().nullable(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  status: userStatusSchema,
  credentialKind: credentialKindSchema.nullable(),
  role: z.object({ id: idSchema, name: z.string(), systemKey: systemRoleKeySchema.nullable() }),
  managerId: idSchema.nullable(),
  managerName: z.string().nullable(),
  siteIds: z.array(idSchema),
  teamIds: z.array(idSchema),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const userListQuerySchema = cursorQuerySchema.extend({
  status: userStatusSchema.optional(),
  kind: userKindSchema.optional(),
  roleId: idSchema.optional(),
  teamId: idSchema.optional(),
  siteId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type UserListQuery = z.input<typeof userListQuerySchema>;

const profileFields = {
  fullName: z.string().trim().min(2).max(120),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  roleId: idSchema,
  managerId: idSchema.nullable().optional(),
  siteIds: z.array(idSchema).max(500).default([]),
  teamIds: z.array(idSchema).max(500).default([]),
};

export const createWorkerInputSchema = z
  .object({
    ...profileFields,
    username: usernameSchema,
    credentialKind: credentialKindSchema.default('pin'),
    secret: z.string().max(128).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.secret) return;
    const r = secretSchemaFor(v.credentialKind).safeParse(v.secret);
    if (!r.success) {
      ctx.addIssue({ code: 'custom', path: ['secret'], message: r.error.issues[0]?.message ?? 'errors.validation.invalid' });
    }
  });
export type CreateWorkerInput = z.input<typeof createWorkerInputSchema>;

export const inviteStaffInputSchema = z.object({ ...profileFields, email: emailSchema });
export type InviteStaffInput = z.input<typeof inviteStaffInputSchema>;

export const updateUserInputSchema = z.object({
  fullName: profileFields.fullName.optional(),
  jobTitle: profileFields.jobTitle,
  phone: profileFields.phone,
  roleId: idSchema.optional(),
  managerId: idSchema.nullable().optional(),
  username: usernameSchema.optional(),
});
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;

export const setUserSitesInputSchema = z.object({ siteIds: z.array(idSchema).max(500) });
export type SetUserSitesInput = z.input<typeof setUserSitesInputSchema>;

export const setUserTeamsInputSchema = z.object({ teamIds: z.array(idSchema).max(500) });
export type SetUserTeamsInput = z.input<typeof setUserTeamsInputSchema>;

export const resetCredentialInputSchema = z.object({
  credentialKind: credentialKindSchema.optional(),
  secret: z.string().max(128).optional(),
});
export type ResetCredentialInput = z.input<typeof resetCredentialInputSchema>;

export const userWithSecretSchema = z.object({ user: userDtoSchema, generatedSecret: z.string().nullable() });
export type UserWithSecret = z.infer<typeof userWithSecretSchema>;

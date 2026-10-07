import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { credentialKindSchema, emailSchema, orgCodeSchema, passwordSchema } from './credentials.js';
import { dataScopeSchema, permissionKeySchema, systemRoleKeySchema } from './permissions.js';

export const clientSchema = z.enum(['web', 'mobile']);
export type Client = z.infer<typeof clientSchema>;

const loginIdentifier = z.string().trim().toLowerCase().min(1).max(254);
const tokenString = z.string().min(10).max(512);

export const signupInputSchema = z.object({
  orgName: z.string().trim().min(1).max(120),
  orgCode: orgCodeSchema,
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  client: clientSchema,
});
export type SignupInput = z.input<typeof signupInputSchema>;

export const loginStaffInputSchema = z.object({
  email: loginIdentifier,
  password: z.string().min(1).max(128),
  client: clientSchema,
});
export type LoginStaffInput = z.input<typeof loginStaffInputSchema>;

export const loginWorkerInputSchema = z.object({
  orgCode: loginIdentifier,
  username: loginIdentifier,
  secret: z.string().min(1).max(128),
  client: clientSchema,
});
export type LoginWorkerInput = z.input<typeof loginWorkerInputSchema>;

export const refreshInputSchema = z.object({ refreshToken: tokenString.optional() });
export type RefreshInput = z.input<typeof refreshInputSchema>;

export const verifyEmailInputSchema = z.object({ token: tokenString });
export type VerifyEmailInput = z.input<typeof verifyEmailInputSchema>;

export const inviteAcceptInputSchema = z.object({ token: tokenString, password: passwordSchema, client: clientSchema });
export type InviteAcceptInput = z.input<typeof inviteAcceptInputSchema>;

export const forgotPasswordInputSchema = z.object({ email: loginIdentifier });
export type ForgotPasswordInput = z.input<typeof forgotPasswordInputSchema>;

export const resetPasswordInputSchema = z.object({ token: tokenString, password: passwordSchema });
export type ResetPasswordInput = z.input<typeof resetPasswordInputSchema>;

export const changeCredentialInputSchema = z.object({
  currentSecret: z.string().min(1).max(128),
  newSecret: z.string().min(1).max(128),
});
export type ChangeCredentialInput = z.input<typeof changeCredentialInputSchema>;

export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    jobTitle: z.string().nullable(),
    kind: z.enum(['worker', 'staff']),
    email: z.string().nullable(),
    username: z.string().nullable(),
    emailVerified: z.boolean(),
    credentialKind: credentialKindSchema.nullable(),
  }),
  role: z.object({ id: idSchema, name: z.string(), systemKey: systemRoleKeySchema.nullable(), dataScope: dataScopeSchema }),
  permissions: z.array(permissionKeySchema),
  tenant: z.object({ id: idSchema, name: z.string(), orgCode: z.string(), timezone: z.string(), locale: z.string() }),
});
export type Me = z.infer<typeof meSchema>;

export const loginResultSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshToken: z.string().nullable(),
  me: meSchema,
});
export type LoginResult = z.infer<typeof loginResultSchema>;

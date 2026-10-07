import { z } from 'zod';
import { idSchema } from './common.js';
import { dataScopeSchema, permissionKeySchema, systemRoleKeySchema } from './permissions.js';

export const roleDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  systemKey: systemRoleKeySchema.nullable(),
  dataScope: dataScopeSchema,
  editable: z.boolean(),
  active: z.boolean(),
  permissions: z.array(permissionKeySchema),
  userCount: z.number().int(),
});
export type RoleDto = z.infer<typeof roleDtoSchema>;

export const createRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  dataScope: dataScopeSchema,
  permissions: z.array(permissionKeySchema).default([]),
});
export type CreateRoleInput = z.input<typeof createRoleInputSchema>;

export const updateRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  dataScope: dataScopeSchema.optional(),
  active: z.boolean().optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleInputSchema>;

export const setRolePermissionsInputSchema = z.object({ permissions: z.array(permissionKeySchema) });
export type SetRolePermissionsInput = z.input<typeof setRolePermissionsInputSchema>;

export const permissionCatalogSchema = z.array(z.object({ group: z.string(), keys: z.array(permissionKeySchema) }));
export type PermissionCatalog = z.infer<typeof permissionCatalogSchema>;

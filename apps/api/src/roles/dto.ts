import {
  createRoleInputSchema,
  permissionCatalogSchema,
  roleDtoSchema,
  setRolePermissionsInputSchema,
  updateRoleInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateRoleDto extends createZodDto(createRoleInputSchema) {}
export class UpdateRoleDto extends createZodDto(updateRoleInputSchema) {}
export class SetRolePermissionsDto extends createZodDto(setRolePermissionsInputSchema) {}
export class RoleResponse extends createZodDto(roleDtoSchema) {}
export class PermissionCatalogResponse extends createZodDto(permissionCatalogSchema) {}

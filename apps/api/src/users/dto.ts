import {
  createWorkerInputSchema,
  inviteStaffInputSchema,
  pageOf,
  resetCredentialInputSchema,
  setUserSitesInputSchema,
  setUserTeamsInputSchema,
  updateUserInputSchema,
  userDtoSchema,
  userListQuerySchema,
  userWithSecretSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class UserListQueryDto extends createZodDto(userListQuerySchema) {}
export class CreateWorkerDto extends createZodDto(createWorkerInputSchema) {}
export class InviteStaffDto extends createZodDto(inviteStaffInputSchema) {}
export class UpdateUserDto extends createZodDto(updateUserInputSchema) {}
export class SetUserSitesDto extends createZodDto(setUserSitesInputSchema) {}
export class SetUserTeamsDto extends createZodDto(setUserTeamsInputSchema) {}
export class ResetCredentialDto extends createZodDto(resetCredentialInputSchema) {}
export class UserResponse extends createZodDto(userDtoSchema) {}
export class UserPageResponse extends createZodDto(pageOf(userDtoSchema)) {}
export class UserWithSecretResponse extends createZodDto(userWithSecretSchema) {}

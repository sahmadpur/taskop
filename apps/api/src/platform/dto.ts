import { pageOf, platformLoginInputSchema, platformLoginResultSchema, platformTenantDtoSchema, platformTenantListQuerySchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class PlatformLoginDto extends createZodDto(platformLoginInputSchema) {}
export class PlatformLoginResponse extends createZodDto(platformLoginResultSchema) {}
export class PlatformTenantListQueryDto extends createZodDto(platformTenantListQuerySchema) {}
export class PlatformTenantResponse extends createZodDto(platformTenantDtoSchema) {}
export class PlatformTenantPageResponse extends createZodDto(pageOf(platformTenantDtoSchema)) {}

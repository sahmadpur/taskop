import { claimCommandSchema, claimResultSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ClaimCommandDto extends createZodDto(claimCommandSchema) {}
export class ClaimResultResponse extends createZodDto(claimResultSchema) {}

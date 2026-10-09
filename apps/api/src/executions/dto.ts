import { claimCommandSchema, claimResultSchema, mediaUploadTicketSchema, registerMediaCommandSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ClaimCommandDto extends createZodDto(claimCommandSchema) {}
export class ClaimResultResponse extends createZodDto(claimResultSchema) {}
export class RegisterMediaCommandDto extends createZodDto(registerMediaCommandSchema) {}
export class MediaUploadTicketResponse extends createZodDto(mediaUploadTicketSchema) {}

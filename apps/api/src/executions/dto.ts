import { claimCommandSchema, claimResultSchema, completeCommandSchema, completeResultSchema, mediaUploadTicketSchema, registerMediaCommandSchema, saveAnswersCommandSchema, saveAnswersResultSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ClaimCommandDto extends createZodDto(claimCommandSchema) {}
export class ClaimResultResponse extends createZodDto(claimResultSchema) {}
export class RegisterMediaCommandDto extends createZodDto(registerMediaCommandSchema) {}
export class MediaUploadTicketResponse extends createZodDto(mediaUploadTicketSchema) {}
export class SaveAnswersCommandDto extends createZodDto(saveAnswersCommandSchema) {}
export class SaveAnswersResultResponse extends createZodDto(saveAnswersResultSchema) {}
export class CompleteCommandDto extends createZodDto(completeCommandSchema) {}
export class CompleteResultResponse extends createZodDto(completeResultSchema) {}

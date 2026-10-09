import { claimCommandSchema, claimResultSchema, completeCommandSchema, completeResultSchema, executionDetailSchema, mediaConfirmResultSchema, mediaUploadTicketSchema, mediaUrlSchema, pageOf, problemDtoSchema, problemListQuerySchema, registerMediaCommandSchema, saveAnswersCommandSchema, saveAnswersResultSchema, syncQuerySchema, syncResponseSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ClaimCommandDto extends createZodDto(claimCommandSchema) {}
export class ClaimResultResponse extends createZodDto(claimResultSchema) {}
export class RegisterMediaCommandDto extends createZodDto(registerMediaCommandSchema) {}
export class MediaUploadTicketResponse extends createZodDto(mediaUploadTicketSchema) {}
export class SaveAnswersCommandDto extends createZodDto(saveAnswersCommandSchema) {}
export class SaveAnswersResultResponse extends createZodDto(saveAnswersResultSchema) {}
export class CompleteCommandDto extends createZodDto(completeCommandSchema) {}
export class CompleteResultResponse extends createZodDto(completeResultSchema) {}
export class SyncQueryDto extends createZodDto(syncQuerySchema) {}
export class SyncResponseDto extends createZodDto(syncResponseSchema) {}
export class MediaConfirmResultResponse extends createZodDto(mediaConfirmResultSchema) {}
export class MediaUrlResponse extends createZodDto(mediaUrlSchema) {}
export class ExecutionDetailResponse extends createZodDto(executionDetailSchema) {}
export class ProblemListQueryDto extends createZodDto(problemListQuerySchema) {}
export class ProblemPageResponse extends createZodDto(pageOf(problemDtoSchema)) {}

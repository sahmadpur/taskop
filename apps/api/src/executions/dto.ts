import { claimCommandSchema, claimResultSchema, completeCommandSchema, completeResultSchema, correctAnswersInputSchema, correctionResultSchema, executionDetailSchema, mediaConfirmResultSchema, mediaUploadTicketSchema, mediaUrlSchema, pageOf, problemDtoSchema, problemListQuerySchema, registerMediaCommandSchema, resubmitCommandSchema, resubmitResultSchema, reworkRequestSchema, saveAnswersCommandSchema, saveAnswersResultSchema, sendBackInputSchema, syncQuerySchema, syncResponseSchema } from '@taskop/contracts';
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
export class CorrectAnswersDto extends createZodDto(correctAnswersInputSchema) {}
export class CorrectionResultResponse extends createZodDto(correctionResultSchema) {}
export class SendBackDto extends createZodDto(sendBackInputSchema) {}
export class ReworkRequestResponse extends createZodDto(reworkRequestSchema) {}
export class ResubmitCommandDto extends createZodDto(resubmitCommandSchema) {}
export class ResubmitResultResponse extends createZodDto(resubmitResultSchema) {}

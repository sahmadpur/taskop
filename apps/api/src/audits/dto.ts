import { auditDetailSchema, auditDtoSchema, auditItemVerdictSchema, auditQueuePageSchema, auditQueueQuerySchema, auditVerdictInputSchema, cancelAuditInputSchema, finishAuditInputSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class AuditDtoResponse extends createZodDto(auditDtoSchema) {}
export class AuditDetailResponse extends createZodDto(auditDetailSchema) {}
export class AuditItemVerdictResponse extends createZodDto(auditItemVerdictSchema) {}
export class AuditVerdictDto extends createZodDto(auditVerdictInputSchema) {}
export class CancelAuditDto extends createZodDto(cancelAuditInputSchema) {}
export class FinishAuditDto extends createZodDto(finishAuditInputSchema) {}
export class AuditQueueQueryDto extends createZodDto(auditQueueQuerySchema) {}
export class AuditQueuePageResponse extends createZodDto(auditQueuePageSchema) {}

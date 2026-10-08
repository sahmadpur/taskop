import {
  checklistDetailSchema,
  checklistListQuerySchema,
  checklistSummarySchema,
  checklistVersionSchema,
  checklistVersionSummarySchema,
  contentSaveResultSchema,
  createChecklistInputSchema,
  createTemplateInputSchema,
  globalTemplateSchema,
  globalTemplateSummarySchema,
  pageOf,
  publishInputSchema,
  saveAsTemplateInputSchema,
  saveContentInputSchema,
  startDraftInputSchema,
  templateListQuerySchema,
  templateSchema,
  templateSummarySchema,
  updateChecklistInputSchema,
  updateGlobalTemplateInputSchema,
  updateTemplateInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ChecklistListQueryDto extends createZodDto(checklistListQuerySchema) {}
export class CreateChecklistDto extends createZodDto(createChecklistInputSchema) {}
export class UpdateChecklistDto extends createZodDto(updateChecklistInputSchema) {}
export class StartDraftDto extends createZodDto(startDraftInputSchema) {}
export class SaveContentDto extends createZodDto(saveContentInputSchema) {}
export class PublishDto extends createZodDto(publishInputSchema) {}
export class SaveAsTemplateDto extends createZodDto(saveAsTemplateInputSchema) {}
export class TemplateListQueryDto extends createZodDto(templateListQuerySchema) {}
export class CreateTemplateDto extends createZodDto(createTemplateInputSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateInputSchema) {}
export class UpdateGlobalTemplateDto extends createZodDto(updateGlobalTemplateInputSchema) {}

export class ChecklistPageResponse extends createZodDto(pageOf(checklistSummarySchema)) {}
export class ChecklistDetailResponse extends createZodDto(checklistDetailSchema) {}
export class ChecklistVersionResponse extends createZodDto(checklistVersionSchema) {}
export class ChecklistVersionSummaryResponse extends createZodDto(checklistVersionSummarySchema) {}
export class ContentSaveResultResponse extends createZodDto(contentSaveResultSchema) {}
export class TemplateSummaryResponse extends createZodDto(templateSummarySchema) {}
export class TemplateResponse extends createZodDto(templateSchema) {}
export class GlobalTemplateSummaryResponse extends createZodDto(globalTemplateSummarySchema) {}
export class GlobalTemplateResponse extends createZodDto(globalTemplateSchema) {}

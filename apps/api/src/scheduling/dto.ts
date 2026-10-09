import {
  assignmentDetailSchema,
  assignmentDtoSchema,
  assignmentListQuerySchema,
  assignmentPreviewSchema,
  createAssignmentInputSchema,
  pageOf,
  previewAssignmentInputSchema,
  updateAssignmentInputSchema,
  copyRosterInputSchema,
  createShiftInputSchema,
  putRosterInputSchema,
  rosterCopyResultSchema,
  rosterDtoSchema,
  rosterQuerySchema,
  shiftDtoSchema,
  shiftListQuerySchema,
  updateShiftInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ShiftListQueryDto extends createZodDto(shiftListQuerySchema) {}
export class CreateShiftDto extends createZodDto(createShiftInputSchema) {}
export class UpdateShiftDto extends createZodDto(updateShiftInputSchema) {}
export class ShiftResponse extends createZodDto(shiftDtoSchema) {}
export class RosterQueryDto extends createZodDto(rosterQuerySchema) {}
export class PutRosterDto extends createZodDto(putRosterInputSchema) {}
export class CopyRosterDto extends createZodDto(copyRosterInputSchema) {}
export class RosterResponse extends createZodDto(rosterDtoSchema) {}
export class RosterCopyResultResponse extends createZodDto(rosterCopyResultSchema) {}

export class AssignmentListQueryDto extends createZodDto(assignmentListQuerySchema) {}
export class CreateAssignmentDto extends createZodDto(createAssignmentInputSchema) {}
export class UpdateAssignmentDto extends createZodDto(updateAssignmentInputSchema) {}
export class PreviewAssignmentDto extends createZodDto(previewAssignmentInputSchema) {}
export class AssignmentPageResponse extends createZodDto(pageOf(assignmentDtoSchema)) {}
export class AssignmentDetailResponse extends createZodDto(assignmentDetailSchema) {}
export class AssignmentPreviewResponse extends createZodDto(assignmentPreviewSchema) {}

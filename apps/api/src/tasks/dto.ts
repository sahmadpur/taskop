import {
  cancelTaskSchema,
  createTaskSchema,
  pageOf,
  reviewTaskSchema,
  submissionSchema,
  taskActionCommandSchema,
  taskAssigneeOptionsSchema,
  taskAssigneeQuerySchema,
  taskDetailSchema,
  taskListQuerySchema,
  taskMediaRegisterSchema,
  taskSummarySchema,
  updateTaskSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateTaskDto extends createZodDto(createTaskSchema) {}
export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}
export class CancelTaskDto extends createZodDto(cancelTaskSchema) {}
export class ReviewTaskDto extends createZodDto(reviewTaskSchema) {}
export class TaskActionCommandDto extends createZodDto(taskActionCommandSchema) {}
export class SubmissionDto extends createZodDto(submissionSchema) {}
export class TaskMediaRegisterDto extends createZodDto(taskMediaRegisterSchema) {}
export class TaskListQueryDto extends createZodDto(taskListQuerySchema) {}
export class TaskAssigneeQueryDto extends createZodDto(taskAssigneeQuerySchema) {}
export class TaskDetailResponse extends createZodDto(taskDetailSchema) {}
export class TaskPageResponse extends createZodDto(pageOf(taskSummarySchema)) {}
export class TaskAssigneeOptionsResponse extends createZodDto(taskAssigneeOptionsSchema) {}

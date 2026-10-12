import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MediaUploadTicket, TaskAssigneeOptions, TaskDetail } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { MediaUploadTicketResponse } from '../executions/dto';
import {
  CancelTaskDto,
  CreateTaskDto,
  ReviewTaskDto,
  SubmissionDto,
  TaskActionCommandDto,
  TaskAssigneeOptionsResponse,
  TaskAssigneeQueryDto,
  TaskDetailResponse,
  TaskMediaRegisterDto,
  UpdateTaskDto,
} from './dto';
import { TaskAssignees } from './task-assignees';
import { TaskMediaService } from './task-media.service';
import { TaskQueries } from './task-queries';
import { TaskWorkService } from './task-work.service';
import { TasksService } from './tasks.service';

/** Spec §6.2. Routes without a permission decorator decide access in the service (spec §6.1). */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(TaskQueries) private readonly queries: TaskQueries,
    @Inject(TaskAssignees) private readonly assignees: TaskAssignees,
    @Inject(TaskWorkService) private readonly work: TaskWorkService,
    @Inject(TaskMediaService) private readonly media: TaskMediaService,
  ) {}

  /** Declared before `:id`, so "assignees" is never parsed as an id. */
  @Get('assignees')
  @RequirePermission('tasks.manage')
  @ApiOkResponse({ type: TaskAssigneeOptionsResponse })
  options(@CurrentPrincipal() p: Principal, @Query() q: TaskAssigneeQueryDto): Promise<TaskAssigneeOptions> {
    return this.assignees.options(p, q.q);
  }

  @Get(':id')
  @ApiOkResponse({ type: TaskDetailResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<TaskDetail> {
    return this.queries.detail(p, id);
  }

  @Post()
  @RequirePermission('tasks.manage')
  @ApiCreatedResponse({ type: TaskDetailResponse })
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateTaskDto): Promise<TaskDetail> {
    return this.tasks.create(p, body);
  }

  @Patch(':id')
  @RequirePermission('tasks.manage')
  @ApiOkResponse({ type: TaskDetailResponse })
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: UpdateTaskDto): Promise<TaskDetail> {
    return this.tasks.update(p, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('tasks.manage')
  @ApiOkResponse({ type: TaskDetailResponse })
  cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: CancelTaskDto): Promise<TaskDetail> {
    return this.tasks.cancel(p, id, body);
  }

  /** The creator, or anyone who can manage the task (spec §6.1). */
  @Post(':id/review')
  @HttpCode(200)
  @ApiOkResponse({ type: TaskDetailResponse })
  review(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: ReviewTaskDto): Promise<TaskDetail> {
    return this.tasks.review(p, id, body);
  }

  /** The assignee, or a team member while nobody has accepted (spec Decision 8). */
  @Post(':id/accept')
  @HttpCode(200)
  @ApiOkResponse({ type: TaskDetailResponse })
  accept(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: TaskActionCommandDto): Promise<TaskDetail> {
    return this.work.accept(p, id, body);
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOkResponse({ type: TaskDetailResponse })
  start(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: TaskActionCommandDto): Promise<TaskDetail> {
    return this.work.start(p, id, body);
  }

  /** The assignee (spec §6.2). Idempotent on the submission id. */
  @Post(':id/submissions')
  @HttpCode(200)
  @ApiOkResponse({ type: TaskDetailResponse })
  submit(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SubmissionDto): Promise<TaskDetail> {
    return this.work.submit(p, id, body);
  }

  /** Instruction media: creator or manager. Response media: the assignee (spec §6.2). */
  @Post(':id/media')
  @HttpCode(200)
  @ApiOkResponse({ type: MediaUploadTicketResponse })
  registerMedia(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: TaskMediaRegisterDto): Promise<MediaUploadTicket> {
    return this.media.register(p, id, body);
  }
}

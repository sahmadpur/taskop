import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TaskAssigneeOptions, TaskDetail } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { CreateTaskDto, TaskAssigneeOptionsResponse, TaskAssigneeQueryDto, TaskDetailResponse } from './dto';
import { TaskAssignees } from './task-assignees';
import { TaskQueries } from './task-queries';
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
}

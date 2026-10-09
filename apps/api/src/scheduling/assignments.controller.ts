import { Body, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { AssignmentDetail, AssignmentDto, AssignmentPreview, Page } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from './actor';
import { AssignmentsService } from './assignments.service';
import {
  AssignmentDetailResponse,
  AssignmentListQueryDto,
  AssignmentPageResponse,
  AssignmentPreviewResponse,
  CreateAssignmentDto,
  PreviewAssignmentDto,
} from './dto';

export function assignmentsControllerFor(mode: RouteMode) {
  const view = perm(mode, 'assignments.view');
  const manage = perm(mode, 'assignments.view', 'assignments.manage', 'checklists.view');

  @controllerDecorators(mode, 'assignments', 'scheduling')
  class AssignmentsController {
    constructor(@Inject(AssignmentsService) private readonly assignments: AssignmentsService) {}

    @Get()
    @view
    @ApiOkResponse({ type: AssignmentPageResponse })
    list(@CurrentActor() a: Actor, @Query() q: AssignmentListQueryDto): Promise<Page<AssignmentDto>> {
      return this.assignments.list(a, q);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: AssignmentDetailResponse })
    create(@CurrentActor() a: Actor, @Body() body: CreateAssignmentDto): Promise<AssignmentDetail> {
      return this.assignments.create(a, body);
    }

    @Post('preview')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: AssignmentPreviewResponse })
    preview(@CurrentActor() a: Actor, @Body() body: PreviewAssignmentDto): Promise<AssignmentPreview> {
      return this.assignments.preview(a, body);
    }

    @Get(':id')
    @view
    @ApiOkResponse({ type: AssignmentDetailResponse })
    get(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AssignmentDetail> {
      return this.assignments.get(a, id);
    }
  }
  return named(AssignmentsController, mode === 'tenant' ? 'AssignmentsController' : 'PlatformTenantAssignmentsController');
}

export const TenantAssignmentsController = assignmentsControllerFor('tenant');
export const PlatformTenantAssignmentsController = assignmentsControllerFor('platform');

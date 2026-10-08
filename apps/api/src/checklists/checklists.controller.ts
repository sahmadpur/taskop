import { Body, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { ChecklistDetail, ChecklistSummary, ChecklistVersion, ChecklistVersionSummary, ContentSaveResult, Page } from '@taskop/contracts';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ChecklistsService } from './checklists.service';
import {
  ChecklistDetailResponse,
  ChecklistListQueryDto,
  ChecklistPageResponse,
  ChecklistVersionResponse,
  ChecklistVersionSummaryResponse,
  ContentSaveResultResponse,
  CreateChecklistDto,
  PublishDto,
  SaveContentDto,
  StartDraftDto,
  UpdateChecklistDto,
} from './dto';
import { controllerDecorators, named, perm, type RouteMode } from './route-mode';

export function checklistsControllerFor(mode: RouteMode) {
  const view = perm(mode, 'checklists.view');
  const manage = perm(mode, 'checklists.view', 'checklists.manage');
  const publish = perm(mode, 'checklists.view', 'checklists.publish');

  @controllerDecorators(mode, 'checklists', 'checklists')
  class ChecklistsController {
    constructor(@Inject(ChecklistsService) private readonly checklists: ChecklistsService) {}

    @Get()
    @view
    @ApiOkResponse({ type: ChecklistPageResponse })
    list(@Query() q: ChecklistListQueryDto): Promise<Page<ChecklistSummary>> {
      return this.checklists.list(q);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    create(@Body() body: CreateChecklistDto): Promise<ChecklistDetail> {
      return this.checklists.create(body);
    }

    @Get(':id')
    @view
    @ApiOkResponse({ type: ChecklistDetailResponse })
    get(@Param('id', ParseIdPipe) id: string): Promise<ChecklistDetail> {
      return this.checklists.get(id);
    }

    @Patch(':id')
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateChecklistDto): Promise<ChecklistDetail> {
      return this.checklists.update(id, body);
    }

    @Get(':id/versions/:versionId')
    @view
    @ApiOkResponse({ type: ChecklistVersionResponse })
    version(@Param('id', ParseIdPipe) id: string, @Param('versionId', ParseIdPipe) versionId: string): Promise<ChecklistVersion> {
      return this.checklists.getVersion(id, versionId);
    }

    @Get(':id/draft')
    @view
    @ApiOkResponse({ type: ChecklistVersionResponse })
    draft(@Param('id', ParseIdPipe) id: string): Promise<ChecklistVersion> {
      return this.checklists.getDraft(id);
    }

    @Post(':id/draft')
    @manage
    @ApiOkResponse({ type: ChecklistVersionResponse })
    startDraft(@Param('id', ParseIdPipe) id: string, @Body() body: StartDraftDto): Promise<ChecklistVersion> {
      return this.checklists.startDraft(id, body);
    }

    @Put(':id/draft')
    @manage
    @ApiOkResponse({ type: ContentSaveResultResponse })
    saveDraft(@Param('id', ParseIdPipe) id: string, @Body() body: SaveContentDto): Promise<ContentSaveResult> {
      return this.checklists.saveDraft(id, body);
    }

    @Delete(':id/draft')
    @HttpCode(204)
    @manage
    discardDraft(@Param('id', ParseIdPipe) id: string): Promise<void> {
      return this.checklists.discardDraft(id);
    }

    @Post(':id/publish')
    @HttpCode(200)
    @publish
    @ApiOkResponse({ type: ChecklistVersionSummaryResponse })
    publishDraft(@Param('id', ParseIdPipe) id: string, @Body() body: PublishDto): Promise<ChecklistVersionSummary> {
      return this.checklists.publish(id, body);
    }

    @Post(':id/deactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    deactivate(@Param('id', ParseIdPipe) id: string): Promise<ChecklistDetail> {
      return this.checklists.deactivate(id);
    }

    @Post(':id/reactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    reactivate(@Param('id', ParseIdPipe) id: string): Promise<ChecklistDetail> {
      return this.checklists.reactivate(id);
    }
  }
  return named(ChecklistsController, mode === 'tenant' ? 'ChecklistsController' : 'PlatformTenantChecklistsController');
}

export const TenantChecklistsController = checklistsControllerFor('tenant');
export const PlatformTenantChecklistsController = checklistsControllerFor('platform');

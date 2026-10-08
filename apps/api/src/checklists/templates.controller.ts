import { Body, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { ContentSaveResult, TemplateDto, TemplateSummary } from '@taskop/contracts';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { AppError } from '../common/app-error';
import { ContentSaveResultResponse, CreateTemplateDto, SaveContentDto, TemplateListQueryDto, TemplateResponse, TemplateSummaryResponse, UpdateTemplateDto } from './dto';
import { controllerDecorators, named, perm, type RouteMode } from './route-mode';
import { TemplatesService } from './templates.service';

export function templatesControllerFor(mode: RouteMode) {
  const browse = perm(mode, 'checklists.manage');
  const manage = perm(mode, 'templates.manage');

  @controllerDecorators(mode, 'templates', 'templates')
  class TemplatesController {
    constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

    @Get()
    @browse
    @ApiOkResponse({ type: [TemplateSummaryResponse] })
    list(@Query() q: TemplateListQueryDto): Promise<TemplateSummary[]> {
      return this.templates.list(q);
    }

    @Get(':source/:id')
    @browse
    @ApiOkResponse({ type: TemplateResponse })
    get(@Param('source') source: string, @Param('id', ParseIdPipe) id: string): Promise<TemplateDto> {
      if (source !== 'global' && source !== 'tenant') throw new AppError('NOT_FOUND');
      return this.templates.get(source, id);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    create(@Body() body: CreateTemplateDto): Promise<TemplateDto> {
      return this.templates.create(body);
    }

    @Patch(':id')
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateTemplateDto): Promise<TemplateDto> {
      return this.templates.update(id, body);
    }

    @Put(':id/content')
    @manage
    @ApiOkResponse({ type: ContentSaveResultResponse })
    saveContent(@Param('id', ParseIdPipe) id: string, @Body() body: SaveContentDto): Promise<ContentSaveResult> {
      return this.templates.saveContent(id, body);
    }

    @Post(':id/deactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    deactivate(@Param('id', ParseIdPipe) id: string): Promise<TemplateDto> {
      return this.templates.deactivate(id);
    }

    @Post(':id/reactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    reactivate(@Param('id', ParseIdPipe) id: string): Promise<TemplateDto> {
      return this.templates.reactivate(id);
    }
  }
  return named(TemplatesController, mode === 'tenant' ? 'TemplatesController' : 'PlatformTenantTemplatesController');
}

export const TenantTemplatesController = templatesControllerFor('tenant');
export const PlatformTenantTemplatesController = templatesControllerFor('platform');

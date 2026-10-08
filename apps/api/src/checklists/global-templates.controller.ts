import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ContentSaveResult, GlobalTemplateDto, GlobalTemplateSummary } from '@taskop/contracts';
import { Public } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { AppRequest } from '../common/request';
import { PlatformGuard } from '../platform/platform.guard';
import { ContentSaveResultResponse, CreateTemplateDto, GlobalTemplateResponse, GlobalTemplateSummaryResponse, SaveContentDto, UpdateGlobalTemplateDto } from './dto';
import { GlobalTemplatesService } from './global-templates.service';

@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/templates')
export class GlobalTemplatesController {
  constructor(private readonly templates: GlobalTemplatesService) {}

  @Get()
  @ApiOkResponse({ type: [GlobalTemplateSummaryResponse] })
  list(): Promise<GlobalTemplateSummary[]> {
    return this.templates.list();
  }

  @Get(':id')
  @ApiOkResponse({ type: GlobalTemplateResponse })
  get(@Param('id', ParseIdPipe) id: string): Promise<GlobalTemplateDto> {
    return this.templates.get(id);
  }

  @Post()
  @ApiOkResponse({ type: GlobalTemplateResponse })
  create(@Req() req: AppRequest, @Body() body: CreateTemplateDto): Promise<GlobalTemplateDto> {
    return this.templates.create(req.platformAdminId!, body);
  }

  @Patch(':id')
  @ApiOkResponse({ type: GlobalTemplateResponse })
  update(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string, @Body() body: UpdateGlobalTemplateDto): Promise<GlobalTemplateDto> {
    return this.templates.update(req.platformAdminId!, id, body);
  }

  @Put(':id/content')
  @ApiOkResponse({ type: ContentSaveResultResponse })
  saveContent(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string, @Body() body: SaveContentDto): Promise<ContentSaveResult> {
    return this.templates.saveContent(req.platformAdminId!, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOkResponse({ type: GlobalTemplateResponse })
  publish(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<GlobalTemplateDto> {
    return this.templates.setPublished(req.platformAdminId!, id, true);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOkResponse({ type: GlobalTemplateResponse })
  unpublish(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<GlobalTemplateDto> {
    return this.templates.setPublished(req.platformAdminId!, id, false);
  }
}

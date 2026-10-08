import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SiteDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateSiteDto, MoveSiteDto, SiteResponse, UpdateSiteDto } from './dto';
import { SitesService } from './sites.service';

@ApiTags('sites')
@ApiBearerAuth()
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @RequirePermission('sites.view')
  @ApiOkResponse({ type: [SiteResponse] })
  list(): Promise<SiteDto[]> {
    return this.sites.list();
  }

  @Post()
  @RequirePermission('sites.manage')
  create(@Body() body: CreateSiteDto): Promise<SiteDto> {
    return this.sites.create(body);
  }

  @Patch(':id')
  @RequirePermission('sites.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateSiteDto): Promise<SiteDto> {
    return this.sites.update(id, body);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequirePermission('sites.manage')
  move(@Param('id', ParseIdPipe) id: string, @Body() body: MoveSiteDto): Promise<SiteDto> {
    return this.sites.move(id, body);
  }
}

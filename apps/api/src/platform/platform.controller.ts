import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Page, PlatformLoginResult, PlatformTenantDto } from '@taskop/contracts';
import { Public } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { AppRequest } from '../common/request';
import { PlatformLoginDto, PlatformLoginResponse, PlatformTenantListQueryDto, PlatformTenantPageResponse, PlatformTenantResponse } from './dto';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@Public()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly platform: PlatformService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformLoginResponse })
  login(@Body() body: PlatformLoginDto): Promise<PlatformLoginResult> {
    return this.platform.login(body);
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantPageResponse })
  list(@Query() q: PlatformTenantListQueryDto): Promise<Page<PlatformTenantDto>> {
    return this.platform.listTenants(q);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformTenantResponse })
  suspend(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<PlatformTenantDto> {
    return this.platform.setStatus(req.platformAdminId!, id, 'suspended');
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformTenantResponse })
  reactivate(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<PlatformTenantDto> {
    return this.platform.setStatus(req.platformAdminId!, id, 'active');
  }
}

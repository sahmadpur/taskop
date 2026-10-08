import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TenantDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { TenantResponse, UpdateTenantDto } from './dto';
import { TenantService } from './tenant.service';

@ApiTags('tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  @ApiOkResponse({ type: TenantResponse })
  get(): Promise<TenantDto> {
    return this.tenant.get();
  }

  @Patch()
  @RequirePermission('tenant.manage')
  @ApiOkResponse({ type: TenantResponse })
  update(@Body() body: UpdateTenantDto): Promise<TenantDto> {
    return this.tenant.update(body);
  }
}

import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SyncResponse } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import type { Principal } from '../common/request';
import { SyncQueryDto, SyncResponseDto } from './dto';
import { SyncService } from './sync.service';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('me/sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Get()
  @ApiOkResponse({ type: SyncResponseDto })
  pull(@CurrentPrincipal() p: Principal, @Query() q: SyncQueryDto): Promise<SyncResponse> {
    return this.sync.pull(p, q);
  }
}

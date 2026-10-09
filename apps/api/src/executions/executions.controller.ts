import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ClaimResult } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import type { Principal } from '../common/request';
import { ClaimCommandDto, ClaimResultResponse } from './dto';
import { ExecutionsService } from './executions.service';

/** Upload commands from the phone (spec §6). Any authenticated tenant user; the service checks the executor. */
@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(@Inject(ExecutionsService) private readonly executions: ExecutionsService) {}

  /** A rejected claim is a normal 200 so the outbox moves on (spec §6.2). */
  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: ClaimResultResponse })
  claim(@CurrentPrincipal() p: Principal, @Body() body: ClaimCommandDto): Promise<ClaimResult> {
    return this.executions.claim(p, body);
  }
}

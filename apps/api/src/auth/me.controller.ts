import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Me } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import type { Principal } from '../common/request';
import { MeDto } from './dto';
import { MeService } from './me.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  get(@CurrentPrincipal() p: Principal): Promise<Me> {
    return this.me.load(p.userId);
  }
}

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { OccurrenceDetail, OccurrenceDto, Page } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { type Actor, CurrentActor } from './actor';
import { CancelOccurrenceDto, MyOccurrenceQueryDto, OccurrenceDetailResponse, OccurrenceListQueryDto, OccurrencePageResponse } from './dto';
import { OccurrencesService } from './occurrences.service';

export function occurrencesControllerFor(mode: RouteMode) {
  const view = perm(mode, 'assignments.view');
  const manage = perm(mode, 'assignments.view', 'assignments.manage');

  @controllerDecorators(mode, 'occurrences', 'scheduling')
  class OccurrencesController {
    constructor(@Inject(OccurrencesService) private readonly occurrences: OccurrencesService) {}

    @Get()
    @view
    @ApiOkResponse({ type: OccurrencePageResponse })
    list(@CurrentActor() a: Actor, @Query() q: OccurrenceListQueryDto): Promise<Page<OccurrenceDto>> {
      return this.occurrences.list(a, q);
    }

    @Get(':id')
    @view
    @ApiOkResponse({ type: OccurrenceDetailResponse })
    get(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<OccurrenceDetail> {
      return this.occurrences.get(a, id);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: OccurrenceDetailResponse })
    cancel(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: CancelOccurrenceDto): Promise<OccurrenceDetail> {
      return this.occurrences.cancel(a, id, body);
    }
  }
  return named(OccurrencesController, mode === 'tenant' ? 'OccurrencesController' : 'PlatformTenantOccurrencesController');
}

export const TenantOccurrencesController = occurrencesControllerFor('tenant');
export const PlatformTenantOccurrencesController = occurrencesControllerFor('platform');

@ApiTags('scheduling')
@ApiBearerAuth()
@Controller('me/occurrences')
export class MeOccurrencesController {
  constructor(@Inject(OccurrencesService) private readonly occurrences: OccurrencesService) {}

  @Get()
  @ApiOkResponse({ type: OccurrencePageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: MyOccurrenceQueryDto): Promise<Page<OccurrenceDto>> {
    return this.occurrences.listMine(p, q);
  }
}

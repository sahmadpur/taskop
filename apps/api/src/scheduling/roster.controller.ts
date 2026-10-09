import { Body, Get, Inject, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { RosterCopyResult, RosterDto } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { type Actor, CurrentActor } from './actor';
import { CopyRosterDto, PutRosterDto, RosterCopyResultResponse, RosterQueryDto, RosterResponse } from './dto';
import { RosterService } from './roster.service';

export function rosterControllerFor(mode: RouteMode) {
  const view = perm(mode, 'shifts.view');
  const manage = perm(mode, 'shifts.view', 'shifts.manage');

  @controllerDecorators(mode, 'roster', 'scheduling')
  class RosterController {
    constructor(@Inject(RosterService) private readonly roster: RosterService) {}

    @Get()
    @view
    @ApiOkResponse({ type: RosterResponse })
    get(@CurrentActor() a: Actor, @Query() q: RosterQueryDto): Promise<RosterDto> {
      return this.roster.get(a, q);
    }

    @Put()
    @manage
    @ApiOkResponse({ type: RosterResponse })
    put(@CurrentActor() a: Actor, @Body() body: PutRosterDto): Promise<RosterDto> {
      return this.roster.put(a, body);
    }

    @Post('copy')
    @manage
    @ApiOkResponse({ type: RosterCopyResultResponse })
    copy(@CurrentActor() a: Actor, @Body() body: CopyRosterDto): Promise<RosterCopyResult> {
      return this.roster.copy(a, body);
    }
  }
  return named(RosterController, mode === 'tenant' ? 'RosterController' : 'PlatformTenantRosterController');
}

export const TenantRosterController = rosterControllerFor('tenant');
export const PlatformTenantRosterController = rosterControllerFor('platform');

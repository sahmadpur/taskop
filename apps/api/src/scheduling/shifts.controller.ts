import { Body, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { ShiftDto } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateShiftDto, ShiftListQueryDto, ShiftResponse, UpdateShiftDto } from './dto';
import { ShiftsService } from './shifts.service';

export function shiftsControllerFor(mode: RouteMode) {
  const view = perm(mode, 'shifts.view');
  const manage = perm(mode, 'shifts.view', 'shifts.manage');

  @controllerDecorators(mode, 'shifts', 'scheduling')
  class ShiftsController {
    constructor(@Inject(ShiftsService) private readonly shifts: ShiftsService) {}

    @Get()
    @view
    @ApiOkResponse({ type: [ShiftResponse] })
    list(@Query() q: ShiftListQueryDto): Promise<ShiftDto[]> {
      return this.shifts.list(q);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: ShiftResponse })
    create(@Body() body: CreateShiftDto): Promise<ShiftDto> {
      return this.shifts.create(body);
    }

    @Patch(':id')
    @manage
    @ApiOkResponse({ type: ShiftResponse })
    update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateShiftDto): Promise<ShiftDto> {
      return this.shifts.update(id, body);
    }
  }
  return named(ShiftsController, mode === 'tenant' ? 'ShiftsController' : 'PlatformTenantShiftsController');
}

export const TenantShiftsController = shiftsControllerFor('tenant');
export const PlatformTenantShiftsController = shiftsControllerFor('platform');

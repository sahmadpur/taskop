import { Body, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import type { AuditDetail, AuditDto, AuditItemVerdict } from '@taskop/contracts';
import { controllerDecorators, named, perm, permAny, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from '../scheduling/actor';
import { AuditsService } from './audits.service';
import { AuditDetailResponse, AuditDtoResponse, AuditItemVerdictResponse, AuditVerdictDto, CancelAuditDto } from './dto';

/** /audits (SP8 spec §6.2), for tenant users and platform admins (Spec decision 24). */
export function auditsControllerFor(mode: RouteMode) {
  const perform = perm(mode, 'audits.perform');
  // Managers see audit outcomes through reports.view (spec §5).
  const performOrReports = permAny(mode, 'audits.perform', 'reports.view');

  @controllerDecorators(mode, 'audits', 'audits')
  class AuditsController {
    constructor(@Inject(AuditsService) private readonly audits: AuditsService) {}

    @Get(':id')
    @performOrReports
    @ApiOkResponse({ type: AuditDetailResponse })
    get(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AuditDetail> {
      return this.audits.get(a, id);
    }

    @Put(':id/items/:itemId')
    @perform
    @ApiOkResponse({ type: AuditItemVerdictResponse })
    setVerdict(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Param('itemId', ParseIdPipe) itemId: string, @Body() body: AuditVerdictDto): Promise<AuditItemVerdict> {
      return this.audits.setVerdict(a, id, itemId, body);
    }

    @Delete(':id/items/:itemId')
    @HttpCode(204)
    @perform
    @ApiNoContentResponse()
    clearVerdict(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Param('itemId', ParseIdPipe) itemId: string): Promise<void> {
      return this.audits.clearVerdict(a, id, itemId);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @perform
    @ApiOkResponse({ type: AuditDtoResponse })
    cancel(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: CancelAuditDto): Promise<AuditDto> {
      return this.audits.cancel(a, id, body);
    }
  }
  return named(AuditsController, mode === 'tenant' ? 'AuditsController' : 'PlatformTenantAuditsController');
}

/** POST /executions/:id/audits lives with the audits: executions never depends on this module (NFR-15.02). */
export function executionAuditsControllerFor(mode: RouteMode) {
  const perform = perm(mode, 'audits.perform');

  @controllerDecorators(mode, 'executions', 'audits')
  class ExecutionAuditsController {
    constructor(@Inject(AuditsService) private readonly audits: AuditsService) {}

    @Post(':id/audits')
    @perform
    @ApiCreatedResponse({ type: AuditDtoResponse })
    start(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AuditDto> {
      return this.audits.start(a, id);
    }
  }
  return named(ExecutionAuditsController, mode === 'tenant' ? 'ExecutionAuditsController' : 'PlatformTenantExecutionAuditsController');
}

export const TenantAuditsController = auditsControllerFor('tenant');
export const PlatformTenantAuditsController = auditsControllerFor('platform');
export const TenantExecutionAuditsController = executionAuditsControllerFor('tenant');
export const PlatformTenantExecutionAuditsController = executionAuditsControllerFor('platform');

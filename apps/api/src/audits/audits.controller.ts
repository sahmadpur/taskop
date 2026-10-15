import { Body, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiProduces } from '@nestjs/swagger';
import { AUDIT_REPORT_CONTENT_TYPE, type AuditDetail, type AuditDto, type AuditItemVerdict, type AuditQueueRow, type Page } from '@taskop/contracts';
import { controllerDecorators, named, perm, permAny, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from '../scheduling/actor';
import { AuditQueueQuery } from './audit-queue';
import { AuditsService } from './audits.service';
import { AuditDetailResponse, AuditDtoResponse, AuditItemVerdictResponse, AuditQueuePageResponse, AuditQueueQueryDto, AuditVerdictDto, CancelAuditDto, FinishAuditDto, SendAuditReportDto } from './dto';

/** /audits (SP8 spec §6.2), for tenant users and platform admins (Spec decision 24). */
export function auditsControllerFor(mode: RouteMode) {
  const perform = perm(mode, 'audits.perform');
  // Managers see audit outcomes through reports.view (spec §5).
  const performOrReports = permAny(mode, 'audits.perform', 'reports.view');

  @controllerDecorators(mode, 'audits', 'audits')
  class AuditsController {
    constructor(
      @Inject(AuditsService) private readonly audits: AuditsService,
      @Inject(AuditQueueQuery) private readonly queue: AuditQueueQuery,
    ) {}

    @Get()
    @perform
    @ApiOkResponse({ type: AuditQueuePageResponse })
    list(@CurrentActor() a: Actor, @Query() q: AuditQueueQueryDto): Promise<Page<AuditQueueRow>> {
      return this.queue.page(a, q);
    }

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

    @Post(':id/finish')
    @HttpCode(200)
    @perform
    @ApiOkResponse({ type: AuditDtoResponse })
    finish(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: FinishAuditDto): Promise<AuditDto> {
      return this.audits.finish(a, id, body);
    }

    /** The stored PDF (spec §6.2): REPORT_NOT_READY (409) while it is being built. */
    @Get(':id/report.pdf')
    @performOrReports
    @ApiProduces(AUDIT_REPORT_CONTENT_TYPE)
    @ApiOkResponse({ description: 'The audit report', schema: { type: 'string', format: 'binary' } })
    async report(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<StreamableFile> {
      const file = await this.audits.report(a, id);
      return new StreamableFile(file.stream, {
        type: AUDIT_REPORT_CONTENT_TYPE,
        disposition: `attachment; filename="${file.filename}"`,
        ...(file.length !== undefined ? { length: file.length } : {}),
      });
    }

    @Post(':id/report/send')
    @HttpCode(200)
    @perform
    @ApiOkResponse({ type: AuditDtoResponse })
    sendReport(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: SendAuditReportDto): Promise<AuditDto> {
      return this.audits.sendReport(a, id, body);
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

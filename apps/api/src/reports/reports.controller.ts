import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ReportSummary } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import type { Principal } from '../common/request';
import { ReportFiltersDto, ReportSummaryResponse } from './dto';
import { ReportsService } from './reports.service';

/** Sub-project 7 spec §5.3–§5.4. Every number follows the caller's data scope. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportSummaryResponse })
  summary(@CurrentPrincipal() p: Principal, @Query() q: ReportFiltersDto): Promise<ReportSummary> {
    return this.reports.summary(p, q);
  }
}

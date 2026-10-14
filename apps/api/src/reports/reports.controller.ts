import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { EmployeeReportRow, Page, ReportProblems, ReportRun, ReportSummary, ReportTasks, SiteReportRow } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import type { Principal } from '../common/request';
import {
  EmployeeReportRowResponse,
  ReportFiltersDto,
  ReportProblemsQueryDto,
  ReportProblemsResponse,
  ReportRunPageResponse,
  ReportRunsQueryDto,
  ReportSummaryResponse,
  ReportTasksQueryDto,
  ReportTasksResponse,
  SiteReportRowResponse,
} from './dto';
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

  @Get('sites')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: SiteReportRowResponse, isArray: true })
  sites(@CurrentPrincipal() p: Principal, @Query() q: ReportFiltersDto): Promise<SiteReportRow[]> {
    return this.reports.sites(p, q);
  }

  @Get('employees')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: EmployeeReportRowResponse, isArray: true })
  employees(@CurrentPrincipal() p: Principal, @Query() q: ReportFiltersDto): Promise<EmployeeReportRow[]> {
    return this.reports.employees(p, q);
  }

  @Get('runs')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportRunPageResponse })
  runs(@CurrentPrincipal() p: Principal, @Query() q: ReportRunsQueryDto): Promise<Page<ReportRun>> {
    return this.reports.runs(p, q);
  }

  @Get('problems')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportProblemsResponse })
  problems(@CurrentPrincipal() p: Principal, @Query() q: ReportProblemsQueryDto): Promise<ReportProblems> {
    return this.reports.problems(p, q);
  }

  @Get('tasks')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportTasksResponse })
  tasks(@CurrentPrincipal() p: Principal, @Query() q: ReportTasksQueryDto): Promise<ReportTasks> {
    return this.reports.tasks(p, q);
  }
}

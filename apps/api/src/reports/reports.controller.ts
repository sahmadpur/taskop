import { Controller, Get, Inject, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type EmployeeReportRow,
  type Page,
  REPORT_CONTENT_TYPES,
  REPORT_EXPORT_KINDS,
  reportExportKindSchema,
  type ReportProblems,
  type ReportRun,
  type ReportSummary,
  type ReportTasks,
  type SiteReportRow,
} from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import type { Principal } from '../common/request';
import {
  EmployeeReportRowResponse,
  ReportExportQueryDto,
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
import { ReportExporter } from './report-exporter';
import { ReportsService } from './reports.service';

/** Sub-project 7 spec §5.3–§5.4. Every number follows the caller's data scope. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportExporter) private readonly exporter: ReportExporter,
  ) {}

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

  /** Spec §5.4: the whole file in one response; `full` takes xlsx or pdf. An unknown kind is 404. */
  @Get(':kind/export')
  @RequirePermission('reports.view', 'reports.export')
  @ApiParam({ name: 'kind', enum: REPORT_EXPORT_KINDS })
  @ApiProduces(...Object.values(REPORT_CONTENT_TYPES))
  @ApiOkResponse({ description: 'The report file', schema: { type: 'string', format: 'binary' } })
  async export(@CurrentPrincipal() p: Principal, @Param('kind') kind: string, @Query() q: ReportExportQueryDto): Promise<StreamableFile> {
    const parsed = reportExportKindSchema.safeParse(kind);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    const file = await this.exporter.export(p, parsed.data, q);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${file.filename}"`, length: file.body.length });
  }
}

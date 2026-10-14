import {
  employeeReportRowSchema,
  reportFiltersSchema,
  reportProblemsQuerySchema,
  reportProblemsSchema,
  reportRunPageSchema,
  reportRunsQuerySchema,
  reportSummarySchema,
  reportTasksQuerySchema,
  reportTasksSchema,
  siteReportRowSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}
export class ReportSummaryResponse extends createZodDto(reportSummarySchema) {}
export class SiteReportRowResponse extends createZodDto(siteReportRowSchema) {}
export class EmployeeReportRowResponse extends createZodDto(employeeReportRowSchema) {}
export class ReportRunsQueryDto extends createZodDto(reportRunsQuerySchema) {}
export class ReportRunPageResponse extends createZodDto(reportRunPageSchema) {}
export class ReportProblemsQueryDto extends createZodDto(reportProblemsQuerySchema) {}
export class ReportProblemsResponse extends createZodDto(reportProblemsSchema) {}
export class ReportTasksQueryDto extends createZodDto(reportTasksQuerySchema) {}
export class ReportTasksResponse extends createZodDto(reportTasksSchema) {}

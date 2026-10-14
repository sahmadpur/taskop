import { employeeReportRowSchema, reportFiltersSchema, reportRunPageSchema, reportRunsQuerySchema, reportSummarySchema, siteReportRowSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}
export class ReportSummaryResponse extends createZodDto(reportSummarySchema) {}
export class SiteReportRowResponse extends createZodDto(siteReportRowSchema) {}
export class EmployeeReportRowResponse extends createZodDto(employeeReportRowSchema) {}
export class ReportRunsQueryDto extends createZodDto(reportRunsQuerySchema) {}
export class ReportRunPageResponse extends createZodDto(reportRunPageSchema) {}

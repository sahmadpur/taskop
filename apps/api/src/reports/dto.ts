import { employeeReportRowSchema, reportFiltersSchema, reportSummarySchema, siteReportRowSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}
export class ReportSummaryResponse extends createZodDto(reportSummarySchema) {}
export class SiteReportRowResponse extends createZodDto(siteReportRowSchema) {}
export class EmployeeReportRowResponse extends createZodDto(employeeReportRowSchema) {}

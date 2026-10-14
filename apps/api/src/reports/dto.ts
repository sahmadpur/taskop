import { reportFiltersSchema, reportSummarySchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}
export class ReportSummaryResponse extends createZodDto(reportSummarySchema) {}

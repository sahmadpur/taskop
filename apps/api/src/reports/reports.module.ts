import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TasksModule } from '../tasks/tasks.module';
import { ReportExporter } from './report-exporter';
import { ReportFilterResolver } from './report-filters';
import { ReportQueries } from './report-queries';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Sub-project 7: dashboards, reports and export. No tables of its own; reads scheduling, executions and tasks. */
@Module({
  imports: [SchedulingModule, TasksModule],
  controllers: [ReportsController],
  providers: [ReportExporter, ReportFilterResolver, ReportQueries, ReportsService],
})
export class ReportsModule {}

import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { ExecutionsModule } from '../executions/executions.module';
import { PlatformModule } from '../platform/platform.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PlatformTenantAuditsController, PlatformTenantExecutionAuditsController, TenantAuditsController, TenantExecutionAuditsController } from './audits.controller';
import { AuditQueueQuery } from './audit-queue';
import { AuditsService } from './audits.service';
import { AuditReportLoader } from './report/audit-report-loader';
import { AuditReportJob } from './report/audit-report.job';

/** Sub-project 8: audits. Depends on executions and scheduling; nothing depends on it (NFR-15.02). */
@Module({
  imports: [PlatformModule, SchedulingModule, ExecutionsModule],
  controllers: [TenantAuditsController, PlatformTenantAuditsController, TenantExecutionAuditsController, PlatformTenantExecutionAuditsController],
  providers: [AuditsService, AuditQueueQuery, AuditReportLoader, AuditReportJob, PlatformTenantInterceptor],
})
export class AuditsModule {}

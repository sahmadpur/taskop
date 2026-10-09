import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { AssignmentRules } from './assignment-rules';
import { PlatformTenantAssignmentsController, TenantAssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { OccurrenceQueries } from './occurrence-queries';
import { OccurrenceWriter } from './occurrence-writer';
import { PlatformModule } from '../platform/platform.module';
import { PlatformTenantRosterController, TenantRosterController } from './roster.controller';
import { RosterService } from './roster.service';
import { SchedulingScope } from './scheduling-scope';
import { PlatformTenantShiftsController, TenantShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [PlatformModule],
  controllers: [TenantShiftsController, PlatformTenantShiftsController, TenantRosterController, PlatformTenantRosterController, TenantAssignmentsController, PlatformTenantAssignmentsController],
  providers: [SchedulingScope, ShiftsService, RosterService, PlatformTenantInterceptor, OccurrenceWriter, OccurrenceQueries, AssignmentRules, AssignmentsService],
})
export class SchedulingModule {}

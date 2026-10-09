import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { AssignmentRules } from './assignment-rules';
import { PlatformTenantAssignmentsController, TenantAssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { JobsService } from './jobs.service';
import { EligibilityService } from './eligibility.service';
import { MeOccurrencesController, PlatformTenantOccurrencesController, TenantOccurrencesController } from './occurrences.controller';
import { OccurrencesService } from './occurrences.service';
import { OccurrenceJobs } from './occurrence-jobs';
import { OccurrenceQueries } from './occurrence-queries';
import { OccurrenceWriter } from './occurrence-writer';
import { PlatformModule } from '../platform/platform.module';
import { PlatformTenantRosterController, TenantRosterController } from './roster.controller';
import { RosterService } from './roster.service';
import { SchedulingListeners } from './scheduling-listeners';
import { SchedulingScope } from './scheduling-scope';
import { PlatformTenantShiftsController, TenantShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [PlatformModule],
  controllers: [TenantShiftsController, PlatformTenantShiftsController, TenantRosterController, PlatformTenantRosterController, TenantAssignmentsController, PlatformTenantAssignmentsController, TenantOccurrencesController, PlatformTenantOccurrencesController, MeOccurrencesController],
  providers: [SchedulingScope, ShiftsService, RosterService, PlatformTenantInterceptor, OccurrenceWriter, OccurrenceQueries, AssignmentRules, AssignmentsService, SchedulingListeners, OccurrenceJobs, JobsService, OccurrencesService, EligibilityService],
  exports: [JobsService, EligibilityService, OccurrenceWriter, OccurrenceQueries, SchedulingScope],
})
export class SchedulingModule {}

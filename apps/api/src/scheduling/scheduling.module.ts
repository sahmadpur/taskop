import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { PlatformModule } from '../platform/platform.module';
import { PlatformTenantRosterController, TenantRosterController } from './roster.controller';
import { RosterService } from './roster.service';
import { SchedulingScope } from './scheduling-scope';
import { PlatformTenantShiftsController, TenantShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [PlatformModule],
  controllers: [TenantShiftsController, PlatformTenantShiftsController, TenantRosterController, PlatformTenantRosterController],
  providers: [SchedulingScope, ShiftsService, RosterService, PlatformTenantInterceptor],
})
export class SchedulingModule {}

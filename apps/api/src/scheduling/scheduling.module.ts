import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { PlatformModule } from '../platform/platform.module';
import { SchedulingScope } from './scheduling-scope';
import { PlatformTenantShiftsController, TenantShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [PlatformModule],
  controllers: [TenantShiftsController, PlatformTenantShiftsController],
  providers: [SchedulingScope, ShiftsService, PlatformTenantInterceptor],
})
export class SchedulingModule {}

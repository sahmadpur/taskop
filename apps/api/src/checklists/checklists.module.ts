import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { TenantChecklistsController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';

@Module({
  imports: [PlatformModule],
  controllers: [TenantChecklistsController],
  providers: [ChecklistsService, PlatformTenantInterceptor],
})
export class ChecklistsModule {}

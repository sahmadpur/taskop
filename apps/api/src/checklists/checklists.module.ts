import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { TenantChecklistsController } from './checklists.controller';
import { ChecklistContentSource, ChecklistsService } from './checklists.service';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';
import { TenantTemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [PlatformModule],
  controllers: [TenantChecklistsController, TenantTemplatesController],
  providers: [
    ChecklistsService,
    TemplatesService,
    { provide: ChecklistContentSource, useExisting: TemplatesService },
    PlatformTenantInterceptor,
  ],
})
export class ChecklistsModule {}

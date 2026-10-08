import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { PlatformTenantChecklistsController, TenantChecklistsController } from './checklists.controller';
import { ChecklistContentSource, ChecklistsService } from './checklists.service';
import { GlobalTemplatesController } from './global-templates.controller';
import { GlobalTemplatesService } from './global-templates.service';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';
import { PlatformTenantTemplatesController, TenantTemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [PlatformModule],
  controllers: [
    TenantChecklistsController,
    TenantTemplatesController,
    PlatformTenantChecklistsController,
    PlatformTenantTemplatesController,
    GlobalTemplatesController,
  ],
  providers: [
    ChecklistsService,
    TemplatesService,
    { provide: ChecklistContentSource, useExisting: TemplatesService },
    GlobalTemplatesService,
    PlatformTenantInterceptor,
  ],
})
export class ChecklistsModule {}

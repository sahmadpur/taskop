import { Module } from '@nestjs/common';
import { SiteTypesController } from './site-types.controller';
import { SiteTypesService } from './site-types.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController, SiteTypesController, SitesController],
  providers: [TenantService, SiteTypesService, SitesService],
})
export class TenancyModule {}

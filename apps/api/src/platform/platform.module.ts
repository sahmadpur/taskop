import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthController, PlatformTenantsController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformAuthController, PlatformTenantsController],
  providers: [PlatformService, PlatformGuard],
  // PlatformGuard is used via @UseGuards in other modules (e.g. checklists); re-export AuthModule so TokenService resolves there.
  exports: [PlatformGuard, AuthModule],
})
export class PlatformModule {}

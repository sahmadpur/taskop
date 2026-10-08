import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { DbService } from './db.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  providers: [DbService, AuditService, { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }],
  exports: [DbService, AuditService],
})
export class DbModule {}

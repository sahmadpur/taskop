import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/error.filter';
import { loggerParams } from './common/logger';
import type { AppConfig } from './config/config';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { TeamsModule } from './teams/teams.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { MailModule } from './mail/mail.module';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), LoggerModule.forRoot(loggerParams(config)), DbModule, MailModule, CommonModule, AuthModule, TenancyModule, TeamsModule],
      controllers: [HealthController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}

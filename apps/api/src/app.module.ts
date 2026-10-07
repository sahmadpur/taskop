import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/error.filter';
import { loggerParams } from './common/logger';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), LoggerModule.forRoot(loggerParams(config))],
      controllers: [HealthController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}

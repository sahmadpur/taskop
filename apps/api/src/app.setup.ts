import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context';
import type { AppConfig } from './config/config';

export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  if (config.TRUST_PROXY) express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.setGlobalPrefix('api/v1');
}

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
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
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Taskop API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));
}

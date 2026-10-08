import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}

void bootstrap();

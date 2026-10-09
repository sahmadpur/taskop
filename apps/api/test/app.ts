import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Clock } from '../src/common/clock';
import { type AppConfig, loadConfig } from '../src/config/config';
import { MAILER } from '../src/mail/mailer';
import { MemoryMailer } from './memory-mailer';

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  config: AppConfig;
  mailer: MemoryMailer;
  close: () => Promise<void>;
}

const keys = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_APP_URL: inject('db').appUrl,
    DATABASE_PLATFORM_URL: inject('db').platformUrl,
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    WEB_URL: 'http://localhost:5173',
    SMTP_URL: 'smtp://localhost:1025',
    MAIL_FROM: 'Taskop <no-reply@taskop.test>',
    COOKIE_SECURE: 'false',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_ITERATIONS: '1',
    RL_LOGIN_IP_PER_MIN: '100000',
    RL_LOGIN_ACCOUNT_PER_MIN: '100000',
    RL_SIGNUP_IP_PER_HOUR: '100000',
    RL_FORGOT_IP_PER_HOUR: '100000',
    LOG_LEVEL: 'silent',
    JOBS_ENABLED: 'false',
    ...overrides,
  };
}

export async function createTestApp(overrides: Record<string, string> = {}, opts: { clock?: Clock } = {}): Promise<TestApp> {
  const config = loadConfig(testEnv(overrides));
  const mailer = new MemoryMailer();
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(MAILER)
    .useValue(mailer);
  if (opts.clock) builder = builder.overrideProvider(Clock).useValue(opts.clock);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    config,
    mailer,
    close: () => app.close(),
  };
}

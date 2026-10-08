import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { setupDatabase } from '../src/db/setup';

declare module 'vitest' {
  export interface ProvidedContext {
    db: { ownerUrl: string; appUrl: string; platformUrl: string };
  }
}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('taskop')
    .withUsername('taskop_owner')
    .withPassword('owner')
    .start();
  const ownerUrl = container.getConnectionUri();
  await setupDatabase({ ownerUrl, appPassword: 'app', platformPassword: 'platform' });
  project.provide('db', {
    ownerUrl,
    appUrl: withCredentials(ownerUrl, 'taskop_app', 'app'),
    platformUrl: withCredentials(ownerUrl, 'taskop_platform', 'platform'),
  });
  return async () => {
    await container.stop();
  };
}

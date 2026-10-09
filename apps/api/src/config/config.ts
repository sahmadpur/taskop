import { z } from 'zod';
import '@taskop/contracts';

export const APP_CONFIG = Symbol('APP_CONFIG');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_APP_URL: z.url(),
  DATABASE_PLATFORM_URL: z.url(),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  WEB_URL: z.url(),
  SMTP_URL: z.url(),
  MAIL_FROM: z.string().min(3),
  COOKIE_SECURE: z.stringbool().default(true),
  TRUST_PROXY: z.stringbool().default(false),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
  ARGON2_ITERATIONS: z.coerce.number().int().min(1).default(2),
  RL_LOGIN_IP_PER_MIN: z.coerce.number().int().min(1).default(20),
  RL_LOGIN_ACCOUNT_PER_MIN: z.coerce.number().int().min(1).default(10),
  RL_SIGNUP_IP_PER_HOUR: z.coerce.number().int().min(1).default(10),
  RL_FORGOT_IP_PER_HOUR: z.coerce.number().int().min(1).default(10),
  /** Start pg-boss workers (spec §5). Tests turn it off and call OccurrenceJobs directly. */
  JOBS_ENABLED: z.stringbool().default(true),
  /** Register the cron schedules. Off for tests that start workers but must not touch other tenants. */
  JOBS_CRON: z.stringbool().default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = result.data;
  return {
    ...c,
    JWT_PRIVATE_KEY: c.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    JWT_PUBLIC_KEY: c.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
  };
}

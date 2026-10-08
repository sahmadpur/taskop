import { uuidv7 } from 'uuidv7';
import { afterAll, describe, expect, it } from 'vitest';
import { RateLimitService } from '../src/auth/rate-limit.service';
import { loadConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { testEnv } from './app';

describe('RateLimitService', () => {
  const db = new DbService(loadConfig(testEnv()));
  const limiter = new RateLimitService(db);
  afterAll(() => db.onModuleDestroy());

  it('allows up to the limit then throws RATE_LIMITED with retryAfterSeconds', async () => {
    const key = `test:${uuidv7()}`;
    await limiter.consume(key, 2, 60);
    await limiter.consume(key, 2, 60);
    await expect(limiter.consume(key, 2, 60)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    try {
      await limiter.consume(key, 2, 60);
    } catch (e) {
      expect((e as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
      expect((e as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('counts keys independently', async () => {
    await limiter.consume(`test:${uuidv7()}`, 1, 60);
    await expect(limiter.consume(`test:${uuidv7()}`, 1, 60)).resolves.toBeUndefined();
  });
});

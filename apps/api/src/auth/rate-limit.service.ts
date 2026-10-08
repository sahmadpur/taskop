import { Injectable } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { rateLimits } from '../db/schema';

/** Fixed-window counters in Postgres, so limits hold across API instances. */
@Injectable()
export class RateLimitService {
  constructor(private readonly db: DbService) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = new Date(windowStart + windowMs);
    const [row] = await this.db.platform
      .insert(rateLimits)
      .values({ key: `${key}:${windowStart}`, count: 1, expiresAt })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } })
      .returning({ count: rateLimits.count });
    if (Math.random() < 0.01) {
      void this.db.platform.delete(rateLimits).where(lt(rateLimits.expiresAt, new Date())).catch(() => undefined);
    }
    if ((row?.count ?? 0) > limit) {
      throw new AppError('RATE_LIMITED', { retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)) });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { authTokens } from '../db/schema';
import { generateOpaqueToken, hashOpaqueToken } from './crypto/opaque-token';

export type OneTimePurpose = 'email_verify' | 'invite' | 'password_reset';

export const ONE_TIME_TTL_MS: Record<OneTimePurpose, number> = {
  email_verify: 72 * 3600_000,
  invite: 7 * 24 * 3600_000,
  password_reset: 3600_000,
};

@Injectable()
export class OneTimeTokenService {
  constructor(private readonly db: DbService) {}

  async create(input: { tenantId: string; userId: string; purpose: OneTimePurpose }): Promise<string> {
    const raw = generateOpaqueToken(input.tenantId);
    await this.db.tx().insert(authTokens).values({
      tenantId: input.tenantId,
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + ONE_TIME_TTL_MS[input.purpose]),
    });
    return raw;
  }

  /** Marks the token used and returns its user. Must run inside the token's tenant transaction. */
  async consume(raw: string, purpose: OneTimePurpose): Promise<{ userId: string }> {
    const [row] = await this.db
      .tx()
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, hashOpaqueToken(raw)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: authTokens.userId });
    if (!row) throw new AppError('TOKEN_INVALID');
    return row;
  }
}

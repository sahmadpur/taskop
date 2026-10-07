import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { currentRequestMeta } from '../common/request-context';
import { DbService } from '../db/db.service';
import { sessions } from '../db/schema';
import { generateOpaqueToken, hashOpaqueToken } from './crypto/opaque-token';

export type Client = 'web' | 'mobile';
export const SESSION_TTL_MS: Record<Client, number> = { web: 7 * 24 * 3600_000, mobile: 30 * 24 * 3600_000 };

@Injectable()
export class SessionService {
  constructor(private readonly db: DbService) {}

  async create(input: { tenantId: string; userId: string; client: Client; familyId?: string }): Promise<{
    sessionId: string;
    refreshToken: string;
  }> {
    const meta = currentRequestMeta();
    const refreshToken = generateOpaqueToken(input.tenantId);
    const [row] = await this.db
      .tx()
      .insert(sessions)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        familyId: input.familyId ?? uuidv7(),
        refreshTokenHash: hashOpaqueToken(refreshToken),
        client: input.client,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS[input.client]),
      })
      .returning({ id: sessions.id });
    return { sessionId: row!.id, refreshToken };
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db
      .tx()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined),
      );
  }
}

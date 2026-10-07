import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/config';

export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
export const PLATFORM_TOKEN_TTL_MS = 8 * 60 * 60_000;
const ISSUER = 'taskop';
const APP_AUDIENCE = 'taskop-app';
const PLATFORM_AUDIENCE = 'taskop-platform';

export interface AccessClaims {
  sub: string;
  tid: string;
  rid: string;
  rv: number;
  kind: 'worker' | 'staff';
  sid: string;
}

const accessPayload = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  rid: z.uuid(),
  rv: z.number().int(),
  kind: z.enum(['worker', 'staff']),
  sid: z.uuid(),
});

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly keys: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.keys = Promise.all([importPKCS8(config.JWT_PRIVATE_KEY, 'EdDSA'), importSPKI(config.JWT_PUBLIC_KEY, 'EdDSA')]).then(
      ([privateKey, publicKey]) => ({ privateKey, publicKey }),
    );
    this.keys.catch(() => undefined); // surfaced by onModuleInit
  }

  async onModuleInit(): Promise<void> {
    await this.keys;
  }

  async signAccess(c: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const { privateKey } = await this.keys;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    const token = await new SignJWT({ tid: c.tid, rid: c.rid, rv: c.rv, kind: c.kind, sid: c.sid })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience(APP_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);
    return { token, expiresAt };
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    const payload = await this.verify(token, APP_AUDIENCE);
    const parsed = accessPayload.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }

  async signPlatform(adminId: string): Promise<{ token: string; expiresAt: Date }> {
    const { privateKey } = await this.keys;
    const expiresAt = new Date(Date.now() + PLATFORM_TOKEN_TTL_MS);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(adminId)
      .setIssuer(ISSUER)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);
    return { token, expiresAt };
  }

  async verifyPlatform(token: string): Promise<{ sub: string } | null> {
    const payload = await this.verify(token, PLATFORM_AUDIENCE);
    const parsed = z.object({ sub: z.uuid() }).safeParse(payload);
    return parsed.success ? { sub: parsed.data.sub } : null;
  }

  private async verify(token: string, audience: string): Promise<unknown> {
    const { publicKey } = await this.keys;
    try {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience,
        algorithms: ['EdDSA'],
        clockTolerance: 5,
      });
      return payload;
    } catch {
      return null;
    }
  }
}

import { isWeakPin } from '@taskop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config/config';
import { testEnv } from '../../../test/app';
import { generateOpaqueToken, hashOpaqueToken, parseOpaqueToken } from './opaque-token';
import { PasswordHasher } from './password-hasher';
import { generatePassword, generatePin } from './secret-generator';
import { TokenService } from './token.service';


const config = loadConfig(testEnv());
const claims = { sub: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', tid: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60', rid: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e61', rv: 3, kind: 'staff' as const, sid: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e62' };

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(config);
  it('verifies the right secret only', async () => {
    const h = await hasher.hash('correct horse');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(h, 'correct horse')).toBe(true);
    expect(await hasher.verify(h, 'wrong')).toBe(false);
  });
  it('returns false for a missing hash', async () => expect(await hasher.verify(null, 'x')).toBe(false));
});

describe('TokenService', () => {
  const tokens = new TokenService(config);
  afterEach(() => vi.useRealTimers());

  it('round-trips access claims', async () => {
    const { token, expiresAt } = await tokens.signAccess(claims);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await tokens.verifyAccess(token)).toEqual(claims);
  });
  it('rejects tampered tokens', async () => {
    const { token } = await tokens.signAccess(claims);
    expect(await tokens.verifyAccess(token.slice(0, -2) + 'xx')).toBeNull();
  });
  it('keeps app and platform audiences apart', async () => {
    const { token } = await tokens.signPlatform(claims.sub);
    expect(await tokens.verifyAccess(token)).toBeNull();
    expect(await tokens.verifyPlatform(token)).toEqual({ sub: claims.sub });
    const app = await tokens.signAccess(claims);
    expect(await tokens.verifyPlatform(app.token)).toBeNull();
  });
  it('rejects expired tokens', async () => {
    const { token } = await tokens.signAccess(claims);
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    expect(await tokens.verifyAccess(token)).toBeNull();
  });
});

describe('opaque tokens', () => {
  it('embeds the tenant and hashes deterministically', () => {
    const t = generateOpaqueToken(claims.tid);
    expect(parseOpaqueToken(t)).toEqual({ tenantId: claims.tid });
    expect(hashOpaqueToken(t)).toBe(hashOpaqueToken(t));
    expect(hashOpaqueToken(t)).toHaveLength(64);
  });
  it('rejects malformed tokens', () => {
    expect(parseOpaqueToken('nope')).toBeNull();
    expect(parseOpaqueToken('not-a-uuid.' + 'a'.repeat(43))).toBeNull();
    expect(parseOpaqueToken(claims.tid + '.short')).toBeNull();
  });
});

describe('generated secrets', () => {
  it('pins are 6 digits and never weak', () => {
    for (let i = 0; i < 500; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
      expect(isWeakPin(pin)).toBe(false);
    }
  });
  it('passwords are 14 characters', () => expect(generatePassword()).toMatch(/^[A-Za-z0-9]{14}$/));
});

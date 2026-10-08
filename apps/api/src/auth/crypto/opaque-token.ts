import { createHash, randomBytes } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `<tenantId>.<32 random bytes base64url>`: the tenant prefix lets lookups run under RLS. */
export function generateOpaqueToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString('base64url')}`;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseOpaqueToken(token: string): { tenantId: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const tenantId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { tenantId };
}

import type { ErrorCode } from '@taskop/contracts';

export interface PgErrorLike {
  code: string;
  constraint?: string;
}

/** Drizzle wraps driver errors; walk the `cause` chain to find the pg error. */
export function pgErrorOf(e: unknown): PgErrorLike | null {
  let current: unknown = e;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const c = current as { code?: unknown; cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c as PgErrorLike;
    current = c.cause;
  }
  return null;
}

export const UNIQUE_CONSTRAINT_ERRORS: Record<string, { code: ErrorCode; field: string }> = {
  tenants_org_code_uq: { code: 'ORG_CODE_TAKEN', field: 'orgCode' },
  users_email_uq: { code: 'EMAIL_TAKEN', field: 'email' },
  users_tenant_username_uq: { code: 'USERNAME_TAKEN', field: 'username' },
};

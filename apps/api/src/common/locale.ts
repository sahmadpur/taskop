import { type Language, pickLanguage } from '@taskop/i18n';
import { inArray } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { tenants, users } from '../db/schema';

/** The current tenant's locale (RLS returns that one row), as a language. */
export async function tenantLanguage(tx: Tx): Promise<Language> {
  const [tenant] = await tx.select({ locale: tenants.locale }).from(tenants);
  return pickLanguage(tenant?.locale);
}

/**
 * The language server-generated text uses for each user: their own choice, else the tenant's locale. Users not found
 * (deleted, another tenant) get the tenant's language too. Runs inside a tenant transaction.
 */
export async function userLanguages(tx: Tx, userIds: readonly string[]): Promise<Map<string, Language>> {
  const fallback = await tenantLanguage(tx);
  const out = new Map<string, Language>();
  if (!userIds.length) return out;
  const rows = await tx.select({ id: users.id, locale: users.locale }).from(users).where(inArray(users.id, [...new Set(userIds)]));
  const own = new Map(rows.map((r) => [r.id, r.locale]));
  for (const id of userIds) out.set(id, pickLanguage(own.get(id), fallback));
  return out;
}

export async function userLanguage(tx: Tx, userId: string): Promise<Language> {
  return (await userLanguages(tx, [userId])).get(userId)!;
}

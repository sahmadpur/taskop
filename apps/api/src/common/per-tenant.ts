import type { Logger } from '@nestjs/common';
import { type SQL } from 'drizzle-orm';
import type { DbService } from '../db/db.service';
import { sanitiseForLog } from './error.filter';

/** The distinct tenants a `select distinct tenant_id …` finds work for, limited to `only` when given. */
export async function tenantsWith(db: DbService, query: SQL, only?: string[]): Promise<string[]> {
  const r = await db.platform.execute<{ tenant_id: string }>(query);
  const ids = r.rows.map((x) => x.tenant_id);
  return only ? ids.filter((id) => only.includes(id)) : ids;
}

/**
 * Runs `fn` for each tenant, outside any transaction (for work that calls a provider between its transactions).
 * One tenant's failure never blocks the others; the job still fails afterwards so pg-boss retries it.
 */
export async function eachTenant(logger: Logger, label: string, tenantIds: string[], fn: (tenantId: string) => Promise<number>): Promise<number> {
  let total = 0;
  let failed = 0;
  for (const tenantId of tenantIds) {
    try {
      total += await fn(tenantId);
    } catch (e) {
      failed++;
      logger.error(sanitiseForLog(e, null), `${label} failed for tenant ${tenantId}`);
    }
  }
  if (failed) throw new Error(`${label} failed for ${failed} tenant(s)`);
  return total;
}

/**
 * Runs `fn` in one RLS transaction per tenant. One tenant's bad data never blocks the others;
 * the job still fails afterwards so pg-boss retries it.
 */
export function perTenant(db: DbService, logger: Logger, label: string, tenantIds: string[], fn: () => Promise<number>): Promise<number> {
  return eachTenant(logger, label, tenantIds, (tenantId) => db.withTenant(tenantId, null, fn));
}

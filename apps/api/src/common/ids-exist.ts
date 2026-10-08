import { inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/db.service';
import { AppError } from './app-error';

/** RLS hides other tenants' rows, so a count mismatch means a foreign or unknown id. */
export async function assertIdsExist(tx: Executor, table: PgTable, idColumn: PgColumn, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await tx.select({ id: idColumn }).from(table).where(inArray(idColumn, unique));
  if (rows.length !== unique.length) throw new AppError('REFERENCE_NOT_FOUND');
}

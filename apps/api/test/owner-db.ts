import pg from 'pg';
import { inject } from 'vitest';

let pool: pg.Pool | null = null;

/** Superuser query helper for test setup/assertions (bypasses RLS). */
export async function ownerQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  pool ??= new pg.Pool({ connectionString: inject('db').ownerUrl, max: 2 });
  return pool.query<T>(text, params);
}

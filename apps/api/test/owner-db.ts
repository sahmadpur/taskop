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

/**
 * Bulk test seeding as the superuser with foreign-key and other triggers off (`session_replication_role = replica`),
 * in one transaction. Only for seed data built valid by construction: nothing is checked. Inserting 10,000 rows
 * this way is about 4× faster, which keeps volume tests well inside their timeouts on CI's busy runners.
 */
export async function ownerBulkInsert(text: string, params: unknown[] = []): Promise<void> {
  pool ??= new pg.Pool({ connectionString: inject('db').ownerUrl, max: 2 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(text, params);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

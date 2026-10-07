import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export interface SetupOptions {
  ownerUrl: string;
  appPassword: string;
  platformPassword: string;
}

async function ensureLoginRole(client: pg.Client, name: string, password: string, bypassRls: boolean) {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
  const pw = client.escapeLiteral(password);
  if (exists.rowCount === 0) {
    await client.query(`create role ${name} login password ${pw}${bypassRls ? ' bypassrls' : ''}`);
  } else {
    await client.query(`alter role ${name} with login password ${pw}`);
  }
}

/** Creates the app/platform login roles (needs a superuser in dev/test) and applies all migrations. */
export async function setupDatabase(opts: SetupOptions): Promise<void> {
  const client = new pg.Client({ connectionString: opts.ownerUrl });
  await client.connect();
  try {
    await ensureLoginRole(client, 'taskop_app', opts.appPassword, false);
    await ensureLoginRole(client, 'taskop_platform', opts.platformPassword, true);
  } finally {
    await client.end();
  }
  const db = drizzle(opts.ownerUrl);
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await db.$client.end();
  }
}

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const DRIZZLE_DIR = path.resolve(__dirname, '../drizzle');
const LAST_BEFORE_SP8 = '0014_reports_permissions';

function urlFor(database: string): string {
  const u = new URL(inject('db').ownerUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

async function migrateWith(folder: string, database: string): Promise<void> {
  const db = drizzle(urlFor(database));
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await db.$client.end();
  }
}

/**
 * Migrations 0015 (ALTER TYPE … ADD VALUE) and 0016 reach production as one separate run on a database that is
 * already at 0014, and the migrator applies that run in one transaction. A value added by ADD VALUE cannot be used
 * in the transaction that added it, so 0016 must not use 'correction_required' or the new 'rework' state. This
 * replays exactly that path; a fresh-database migrate would not tell the two apart.
 */
describe('upgrading an existing database to the SP8 migrations (0015, 0016)', () => {
  const database = `upgrade_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: pg.Client;
  let partialFolder: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: inject('db').ownerUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);
    // A copy of the migrations folder whose journal stops at 0014.
    partialFolder = mkdtempSync(path.join(tmpdir(), 'taskop-migrations-'));
    cpSync(DRIZZLE_DIR, partialFolder, { recursive: true });
    const journalPath = path.join(partialFolder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    const cut = journal.entries.findIndex((e) => e.tag === LAST_BEFORE_SP8);
    expect(cut).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, cut + 1);
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    rmSync(partialFolder, { recursive: true, force: true });
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  });

  it('applies 0015 and 0016 on top of a committed 0014 database', async () => {
    await migrateWith(partialFolder, database);
    const before = new pg.Client({ connectionString: urlFor(database) });
    await before.connect();
    try {
      const applied = await before.query('select count(*)::int as n from drizzle.__drizzle_migrations');
      expect(applied.rows[0].n).toBe(15);
      expect((await before.query("select to_regclass('public.audits') as t")).rows[0].t).toBeNull();
      expect((await before.query("select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'occurrence_status' and e.enumlabel = 'correction_required'")).rowCount).toBe(0);
    } finally {
      await before.end();
    }

    await migrateWith(DRIZZLE_DIR, database);

    const after = new pg.Client({ connectionString: urlFor(database) });
    await after.connect();
    try {
      const applied = await after.query('select count(*)::int as n from drizzle.__drizzle_migrations');
      // Every migration in the journal, whatever has been added since 0016.
      const journalEntries = (JSON.parse(readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;
      expect(applied.rows[0].n).toBe(journalEntries);
      const tables = await after.query(
        "select relname from pg_class where relname = any($1) and relkind = 'r' order by relname",
        [['audit_item_verdicts', 'audits', 'execution_corrections', 'execution_rework_requests']],
      );
      expect(tables.rows.map((r) => r.relname)).toEqual(['audit_item_verdicts', 'audits', 'execution_corrections', 'execution_rework_requests']);
      const triggers = await after.query("select 1 from pg_trigger where tgname = 'executions_original_immutable'");
      expect(triggers.rowCount).toBe(1);
    } finally {
      await after.end();
    }
  });
});

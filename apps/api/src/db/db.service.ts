import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

interface TenantStore {
  tx: Tx;
  tenantId: string;
  userId: string | null;
  afterCommit: (() => unknown)[];
}

const storage = new AsyncLocalStorage<TenantStore>();

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly app: Db;
  readonly platform: Db;
  private readonly pools: pg.Pool[];
  private readonly logger = new Logger('DbService');

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const appPool = new pg.Pool({ connectionString: config.DATABASE_APP_URL, max: 20 });
    const platformPool = new pg.Pool({ connectionString: config.DATABASE_PLATFORM_URL, max: 5 });
    this.pools = [appPool, platformPool];
    for (const [name, pool] of [['app', appPool], ['platform', platformPool]] as const) {
      // Idle-client errors (e.g. Postgres restart) must not crash the process.
      pool.on('error', (err: Error & { code?: string }) => {
        this.logger.error(`Idle ${name} pool client error: ${err.name} ${err.code ?? ''} ${err.message}`.replace(/\s+/g, ' '));
      });
    }
    this.app = drizzle(appPool, { schema });
    this.platform = drizzle(platformPool, { schema });
  }

  /** Runs `fn` in a transaction where RLS sees `tenantId`. Re-uses an enclosing transaction for the same tenant. */
  async withTenant<T>(tenantId: string, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const current = storage.getStore();
    if (current) {
      if (current.tenantId !== tenantId) throw new Error('Cannot open a transaction for a different tenant');
      return fn(current.tx);
    }
    const afterCommit: (() => unknown)[] = [];
    const result = await this.app.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId ?? ''}, true)`,
      );
      return storage.run({ tx, tenantId, userId, afterCommit }, () => fn(tx));
    });
    // Outside the transaction's async context, so callbacks cannot touch the committed tx.
    storage.exit(() => afterCommit.forEach((cb) => this.runAfterCommit(cb)));
    return result;
  }

  /**
   * Schedules a side effect (e.g. sending mail) for after the enclosing tenant transaction commits.
   * Not awaited by the request; dropped if the transaction rolls back. Runs at once outside a transaction.
   */
  afterCommit(cb: () => unknown): void {
    const current = storage.getStore();
    if (current) current.afterCommit.push(cb);
    else this.runAfterCommit(cb);
  }

  private runAfterCommit(cb: () => unknown): void {
    try {
      void Promise.resolve(cb()).catch((err: unknown) => this.logger.error(`After-commit callback failed: ${String(err)}`));
    } catch (err) {
      this.logger.error(`After-commit callback failed: ${String(err)}`);
    }
  }

  tx(): Tx {
    const current = storage.getStore();
    if (!current) throw new Error('No tenant transaction in scope');
    return current.tx;
  }

  context(): { tenantId: string; userId: string | null } {
    const current = storage.getStore();
    if (!current) throw new Error('No tenant transaction in scope');
    return { tenantId: current.tenantId, userId: current.userId };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.pools.map((p) => p.end()));
  }
}

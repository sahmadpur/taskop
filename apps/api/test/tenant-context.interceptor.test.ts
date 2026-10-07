import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { defer, lastValueFrom, of } from 'rxjs';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../src/common/request';
import { loadConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { siteTypes } from '../src/db/schema';
import { TenantContextInterceptor } from '../src/db/tenant-context.interceptor';
import { testEnv } from './app';
import { ownerQuery } from './owner-db';

describe('TenantContextInterceptor', () => {
  let db: DbService;
  let interceptor: TenantContextInterceptor;
  const T = uuidv7();

  const ctxWith = (principal?: Partial<Principal>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ principal }) }) }) as unknown as ExecutionContext;
  const names = (name: string) =>
    db.withTenant(T, null, (tx) => tx.select().from(siteTypes).where(eq(siteTypes.name, name)));

  beforeAll(async () => {
    db = new DbService(loadConfig(testEnv()));
    interceptor = new TenantContextInterceptor(db);
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'T', $2)", [T, `int-${T.slice(-8)}`]);
  });
  afterAll(() => db.onModuleDestroy());

  it('commits the handler work inside a tenant transaction', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(ctxWith({ tenantId: T, userId: 'u1' }), {
        handle: () =>
          defer(async () => {
            await db.tx().insert(siteTypes).values({ tenantId: T, name: 'committed' });
            return 'ok';
          }),
      }),
    );
    expect(result).toBe('ok');
    expect(await names('committed')).toHaveLength(1);
  });

  it('rolls back and propagates when the handler errors', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxWith({ tenantId: T, userId: 'u1' }), {
          handle: () =>
            defer(async () => {
              await db.tx().insert(siteTypes).values({ tenantId: T, name: 'doomed' });
              throw new Error('boom');
            }),
        }),
      ),
    ).rejects.toThrow('boom');
    expect(await names('doomed')).toEqual([]);
  });

  it('passes through without a principal (no tenant transaction)', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxWith(undefined), {
          handle: () => defer(async () => db.tx()),
        }),
      ),
    ).rejects.toThrow('No tenant transaction in scope');
    expect(await lastValueFrom(interceptor.intercept(ctxWith(undefined), { handle: () => of(7) }))).toBe(7);
  });
});

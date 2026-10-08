import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { roles, tenants, users } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';
import type { AccessClaims } from './crypto/token.service';

const NO_PERMISSIONS: ReadonlySet<PermissionKey> = new Set();

@Injectable()
export class PrincipalLoader {
  private readonly permissionCache = new Map<string, ReadonlySet<PermissionKey>>();

  constructor(private readonly db: DbService) {}

  async load(claims: AccessClaims): Promise<Principal> {
    return this.db.withTenant(claims.tid, claims.sub, async (tx) => {
      const [row] = await tx
        .select({
          status: users.status,
          kind: users.kind,
          emailVerifiedAt: users.emailVerifiedAt,
          roleId: roles.id,
          roleVersion: roles.version,
          systemKey: roles.systemKey,
          dataScope: roles.dataScope,
          roleActive: roles.active,
          tenantStatus: tenants.status,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, claims.sub));
      if (!row || row.status !== 'active') throw new AppError('UNAUTHENTICATED');
      if (row.tenantStatus !== 'active') throw new AppError('TENANT_SUSPENDED');
      // An inactive role grants nothing, whatever permissions it still lists.
      const cacheKey = `${row.roleId}:${row.roleVersion}`;
      let permissions = row.roleActive ? this.permissionCache.get(cacheKey) : NO_PERMISSIONS;
      if (!permissions) {
        permissions = new Set(await loadRolePermissions(tx, { id: row.roleId, systemKey: row.systemKey }));
        if (this.permissionCache.size > 1000) this.permissionCache.clear();
        this.permissionCache.set(cacheKey, permissions);
      }
      return {
        userId: claims.sub,
        tenantId: claims.tid,
        roleId: row.roleId,
        roleVersion: row.roleVersion,
        systemRoleKey: row.systemKey,
        sessionId: claims.sid,
        kind: row.kind,
        dataScope: row.roleActive ? row.dataScope : 'own',
        permissions,
        emailVerified: row.emailVerifiedAt !== null,
      };
    });
  }
}

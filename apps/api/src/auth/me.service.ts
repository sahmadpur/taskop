import { Injectable } from '@nestjs/common';
import type { Me } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { roles, tenants, users } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';

@Injectable()
export class MeService {
  constructor(private readonly db: DbService) {}

  async load(userId: string): Promise<Me> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ user: users, role: roles, tenant: tenants })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, userId));
    if (!row) throw new AppError('UNAUTHENTICATED');
    const permissions = await loadRolePermissions(tx, row.role);
    return {
      user: {
        id: row.user.id,
        fullName: row.user.fullName,
        jobTitle: row.user.jobTitle,
        kind: row.user.kind,
        email: row.user.email,
        username: row.user.username,
        emailVerified: row.user.emailVerifiedAt !== null,
        credentialKind: row.user.credentialKind,
      },
      role: { id: row.role.id, name: row.role.name, systemKey: row.role.systemKey, dataScope: row.role.dataScope },
      permissions,
      tenant: {
        id: row.tenant.id,
        name: row.tenant.name,
        orgCode: row.tenant.orgCode,
        timezone: row.tenant.timezone,
        locale: row.tenant.locale,
      },
    };
  }
}

import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { TaskReader } from '../common/request';
import { DbService } from '../db/db.service';
import { roles, users } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';

/** A user as the data-scope SQL sees them, built from their role like PrincipalLoader (Spec decision 2). */
export type ScopeSubject = TaskReader;

const NOTHING: ReadonlySet<PermissionKey> = new Set();

@Injectable()
export class ScopeSubjects {
  constructor(private readonly db: DbService) {}

  /** Active users holding one of `roleIds`. An inactive role grants nothing, so its holders are left out. */
  async holdersOf(roleIds: string[]): Promise<ScopeSubject[]> {
    if (!roleIds.length) return [];
    const tx = this.db.tx();
    const rows = await tx
      .select({ userId: users.id, roleId: roles.id, systemKey: roles.systemKey, dataScope: roles.dataScope })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(users.roleId, roleIds), eq(users.status, 'active'), eq(roles.active, true)))
      .orderBy(asc(users.id));
    const granted = new Map<string, ReadonlySet<PermissionKey>>();
    for (const r of rows) {
      if (!granted.has(r.roleId)) granted.set(r.roleId, new Set(await loadRolePermissions(tx, { id: r.roleId, systemKey: r.systemKey })));
    }
    return rows.map((r) => ({ userId: r.userId, dataScope: r.dataScope, permissions: granted.get(r.roleId)! }));
  }

  /** One user, whatever their status (a message's sender). An inactive role narrows to own and grants nothing. */
  async forUser(userId: string): Promise<ScopeSubject | null> {
    const tx = this.db.tx();
    const [r] = await tx
      .select({ roleId: roles.id, systemKey: roles.systemKey, dataScope: roles.dataScope, active: roles.active })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, userId));
    if (!r) return null;
    if (!r.active) return { userId, dataScope: 'own', permissions: NOTHING };
    return { userId, dataScope: r.dataScope, permissions: new Set(await loadRolePermissions(tx, { id: r.roleId, systemKey: r.systemKey })) };
  }
}

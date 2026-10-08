import { Injectable } from '@nestjs/common';
import { PERMISSION_GROUPS, type PermissionCatalog, type PermissionKey, type RoleDto } from '@taskop/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { rolePermissions, roles, users } from '../db/schema';
import type { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto';
import { loadRolePermissions } from './permission-resolver';

export function assertNoEscalation(p: Principal, permissions: readonly PermissionKey[]): void {
  if (permissions.some((k) => !p.permissions.has(k))) throw new AppError('ROLE_ESCALATION');
}

const SCOPE_RANK = { all: 3, site_subtree: 2, subordinates: 2, own: 1 } as const;

/** A role may not be given a data scope broader than (or lateral to) the actor's own. */
export function assertNoScopeEscalation(p: Pick<Principal, 'dataScope'>, scope: keyof typeof SCOPE_RANK): void {
  if (p.dataScope === 'all') return;
  const mine = SCOPE_RANK[p.dataScope];
  const wanted = SCOPE_RANK[scope];
  if (wanted > mine || (wanted === 2 && mine === 2 && scope !== p.dataScope)) throw new AppError('ROLE_ESCALATION');
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  catalog(): PermissionCatalog {
    return PERMISSION_GROUPS.map((g) => ({ group: g.group, keys: [...g.keys] }));
  }

  async list(): Promise<RoleDto[]> {
    const rows = await this.db.tx().select().from(roles).orderBy(asc(roles.createdAt));
    const out: RoleDto[] = [];
    for (const r of rows) out.push(await this.toDto(r)); // sequential: one tx connection
    return out;
  }

  async create(p: Principal, input: CreateRoleDto): Promise<RoleDto> {
    const permissions = [...new Set(input.permissions)];
    assertNoEscalation(p, permissions);
    assertNoScopeEscalation(p, input.dataScope);
    const tx = this.db.tx();
    const [row] = await tx.insert(roles).values({ tenantId: p.tenantId, name: input.name, dataScope: input.dataScope }).returning();
    if (permissions.length) {
      await tx.insert(rolePermissions).values(permissions.map((permissionKey) => ({ tenantId: p.tenantId, roleId: row!.id, permissionKey })));
    }
    const dto = await this.toDto(row!);
    await this.audit.record({ action: 'role.created', entityType: 'role', entityId: dto.id, after: dto });
    return dto;
  }

  async update(p: Principal, id: string, input: UpdateRoleDto): Promise<RoleDto> {
    const tx = this.db.tx();
    const existing = await this.find(id);
    if (!existing.editable) throw new AppError('ROLE_NOT_EDITABLE');
    await this.assertCanEdit(p, existing);
    if (input.dataScope) assertNoScopeEscalation(p, input.dataScope);
    if (existing.systemKey && ((input.name !== undefined && input.name !== existing.name) || input.active === false)) {
      throw new AppError('ROLE_NOT_EDITABLE');
    }
    if (input.active === false && existing.active && (await this.countUsers(id)) > 0) throw new AppError('ROLE_IN_USE');
    const before = await this.toDto(existing);
    const [row] = await tx
      .update(roles)
      .set({ name: input.name, dataScope: input.dataScope, active: input.active, version: sql`${roles.version} + 1`, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    const after = await this.toDto(row!);
    await this.audit.record({ action: 'role.updated', entityType: 'role', entityId: id, before, after });
    return after;
  }

  async setPermissions(p: Principal, id: string, input: SetRolePermissionsDto): Promise<RoleDto> {
    const tx = this.db.tx();
    const existing = await this.find(id);
    if (!existing.editable) throw new AppError('ROLE_NOT_EDITABLE');
    await this.assertCanEdit(p, existing);
    const permissions = [...new Set(input.permissions)];
    assertNoEscalation(p, permissions);
    const before = await loadRolePermissions(tx, existing);
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (permissions.length) {
      await tx.insert(rolePermissions).values(permissions.map((permissionKey) => ({ tenantId: p.tenantId, roleId: id, permissionKey })));
    }
    const [row] = await tx
      .update(roles)
      .set({ version: sql`${roles.version} + 1`, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    await this.audit.record({
      action: 'role.permissions_changed',
      entityType: 'role',
      entityId: id,
      before: { permissions: before },
      after: { permissions },
    });
    return this.toDto(row!);
  }

  /** An actor may only edit roles that do not exceed their own permissions or data scope. */
  private async assertCanEdit(p: Principal, role: typeof roles.$inferSelect): Promise<void> {
    assertNoEscalation(p, await loadRolePermissions(this.db.tx(), role));
    assertNoScopeEscalation(p, role.dataScope);
  }

  private async find(id: string) {
    const [row] = await this.db.tx().select().from(roles).where(eq(roles.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async countUsers(roleId: string): Promise<number> {
    const [row] = await this.db
      .tx()
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.roleId, roleId), inArray(users.status, ['active', 'invited'])));
    return row?.n ?? 0;
  }

  private async toDto(r: typeof roles.$inferSelect): Promise<RoleDto> {
    return {
      id: r.id,
      name: r.name,
      systemKey: r.systemKey,
      dataScope: r.dataScope,
      editable: r.editable,
      active: r.active,
      permissions: await loadRolePermissions(this.db.tx(), r),
      userCount: await this.countUsers(r.id),
    };
  }
}

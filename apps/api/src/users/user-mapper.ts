import type { SystemRoleKey, UserDto } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/db.service';
import { roles, users } from '../db/schema';

const manager = alias(users, 'manager');

export function selectUsers(tx: Executor) {
  return tx
    .select({
      user: users,
      roleName: roles.name,
      roleSystemKey: roles.systemKey,
      managerName: manager.fullName,
      siteIds: sql<string[]>`coalesce((select array_agg(us.site_id::text order by us.site_id) from user_sites us where us.user_id = ${users.id}), '{}')`,
      teamIds: sql<string[]>`coalesce((select array_agg(ut.team_id::text order by ut.team_id) from user_teams ut where ut.user_id = ${users.id}), '{}')`,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(manager, eq(manager.id, users.managerId))
    .$dynamic();
}

export interface UserRow {
  user: typeof users.$inferSelect;
  roleName: string;
  roleSystemKey: SystemRoleKey | null;
  managerName: string | null;
  siteIds: string[];
  teamIds: string[];
}

export function toUserDto(r: UserRow): UserDto {
  const u = r.user;
  return {
    id: u.id,
    fullName: u.fullName,
    jobTitle: u.jobTitle,
    kind: u.kind,
    email: u.email,
    username: u.username,
    phone: u.phone,
    status: u.status,
    credentialKind: u.credentialKind,
    role: { id: u.roleId, name: r.roleName, systemKey: r.roleSystemKey },
    managerId: u.managerId,
    managerName: r.managerName,
    siteIds: r.siteIds,
    teamIds: r.teamIds,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

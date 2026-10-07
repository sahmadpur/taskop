import { ALL_PERMISSIONS, type PermissionKey, type SystemRoleKey } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/db.service';
import { rolePermissions } from '../db/schema';

const KNOWN = new Set<string>(ALL_PERMISSIONS);

export async function loadRolePermissions(
  tx: Executor,
  role: { id: string; systemKey: SystemRoleKey | null },
): Promise<PermissionKey[]> {
  if (role.systemKey === 'owner') return [...ALL_PERMISSIONS];
  const rows = await tx.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  return rows.map((r) => r.key).filter((k): k is PermissionKey => KNOWN.has(k));
}

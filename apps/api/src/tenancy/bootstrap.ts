import { SYSTEM_ROLE_DEFAULTS, SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@taskop/contracts';
import type { Executor } from '../db/db.service';
import { rolePermissions, roles, siteTypes } from '../db/schema';

export const DEFAULT_SITE_TYPES = ['Filial', 'Zona', 'Bölmə', 'Yoxlama nöqtəsi'] as const;

/** Seeds site types and the five built-in roles for a new tenant. Must run in that tenant's context. */
export async function seedTenantDefaults(tx: Executor, tenantId: string): Promise<Record<SystemRoleKey, string>> {
  await tx.insert(siteTypes).values(DEFAULT_SITE_TYPES.map((name, i) => ({ tenantId, name, sortOrder: i })));
  const roleIds = {} as Record<SystemRoleKey, string>;
  for (const key of SYSTEM_ROLE_KEYS) {
    const def = SYSTEM_ROLE_DEFAULTS[key];
    const [role] = await tx
      .insert(roles)
      .values({ tenantId, name: def.name, systemKey: key, dataScope: def.dataScope, editable: def.editable })
      .returning({ id: roles.id });
    roleIds[key] = role!.id;
    if (def.permissions.length > 0) {
      await tx.insert(rolePermissions).values(def.permissions.map((permissionKey) => ({ tenantId, roleId: role!.id, permissionKey })));
    }
  }
  return roleIds;
}

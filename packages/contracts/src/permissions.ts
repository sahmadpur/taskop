import { z } from 'zod';

export const PERMISSION_GROUPS = [
  { group: 'tenant', keys: ['tenant.manage'] },
  { group: 'sites', keys: ['sites.view', 'sites.manage'] },
  { group: 'teams', keys: ['teams.view', 'teams.manage'] },
  { group: 'users', keys: ['users.view', 'users.manage'] },
  { group: 'roles', keys: ['roles.view', 'roles.manage'] },
  { group: 'audit', keys: ['audit.view'] },
  { group: 'checklists', keys: ['checklists.view', 'checklists.manage', 'checklists.publish'] },
  { group: 'templates', keys: ['templates.manage'] },
  { group: 'assignments', keys: ['assignments.view', 'assignments.manage', 'assignments.extended_window'] },
  { group: 'shifts', keys: ['shifts.view', 'shifts.manage'] },
] as const;

export type PermissionKey = (typeof PERMISSION_GROUPS)[number]['keys'][number];
export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_GROUPS.flatMap((g) => g.keys);
export const permissionKeySchema = z.enum(ALL_PERMISSIONS as [PermissionKey, ...PermissionKey[]]);

export const DATA_SCOPES = ['all', 'site_subtree', 'subordinates', 'own'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];
export const dataScopeSchema = z.enum(DATA_SCOPES);

export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'manager', 'worker', 'auditor'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
export const systemRoleKeySchema = z.enum(SYSTEM_ROLE_KEYS);

export interface SystemRoleDefault {
  name: string;
  dataScope: DataScope;
  permissions: readonly PermissionKey[];
  editable: boolean;
}

// Owner always has every permission at runtime (resolved in code), even for keys added later.
export const SYSTEM_ROLE_DEFAULTS: Record<SystemRoleKey, SystemRoleDefault> = {
  owner: { name: 'Owner', dataScope: 'all', permissions: ALL_PERMISSIONS, editable: false },
  admin: { name: 'Admin', dataScope: 'all', permissions: ALL_PERMISSIONS, editable: true },
  manager: {
    name: 'Manager',
    dataScope: 'site_subtree',
    permissions: ['sites.view', 'teams.view', 'users.view', 'checklists.view', 'checklists.manage', 'assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage'],
    editable: true,
  },
  worker: { name: 'Worker', dataScope: 'own', permissions: [], editable: true },
  auditor: {
    name: 'Auditor',
    dataScope: 'all',
    permissions: ['sites.view', 'users.view', 'audit.view', 'checklists.view', 'assignments.view', 'shifts.view'],
    editable: true,
  },
};

import type { PermissionKey, SystemRoleKey } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { api } from '@/lib/session';

export const useRoles = (enabled = true) => useQuery({ queryKey: ['roles'], queryFn: api.roles.list, enabled });
export const useCatalog = () => useQuery({ queryKey: ['permissions'], queryFn: api.roles.catalog, staleTime: Infinity });

export const permissionLabelKey = (key: PermissionKey) => `roles.keys.${key.replace('.', '_')}`;

export const roleDisplayName = (t: TFunction, role: { name: string; systemKey: SystemRoleKey | null }) =>
  role.systemKey ? t(`roles.systemNames.${role.systemKey}`) : role.name;

import type { DataScope, PermissionKey, SystemRoleKey } from '@taskop/contracts';
import type { Request } from 'express';

export interface Principal {
  userId: string;
  tenantId: string;
  roleId: string;
  roleVersion: number;
  systemRoleKey: SystemRoleKey | null;
  sessionId: string;
  kind: 'worker' | 'staff';
  dataScope: DataScope;
  permissions: ReadonlySet<PermissionKey>;
  emailVerified: boolean;
}

export interface AppRequest extends Request {
  principal?: Principal;
}

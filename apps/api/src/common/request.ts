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
  platformAdminId?: string;
}

/** What the data-scope SQL reads from a principal. Notification fan-out builds one for recipients who are not the caller. */
export type ScopeHolder = Pick<Principal, 'userId' | 'dataScope'>;

/** What TaskScope's read rules read. */
export type TaskReader = Pick<Principal, 'userId' | 'dataScope' | 'permissions'>;

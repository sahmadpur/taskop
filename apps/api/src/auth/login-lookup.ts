import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { tenants, users } from '../db/schema';

export interface LoginCandidate {
  id: string;
  tenantId: string;
  roleId: string;
  kind: 'worker' | 'staff';
  status: 'active' | 'deactivated' | 'invited';
  credentialHash: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  tenantStatus: 'active' | 'suspended';
}

const candidateColumns = {
  id: users.id,
  tenantId: users.tenantId,
  roleId: users.roleId,
  kind: users.kind,
  status: users.status,
  credentialHash: users.credentialHash,
  failedLoginCount: users.failedLoginCount,
  lockedUntil: users.lockedUntil,
  tenantStatus: tenants.status,
};

/** Pre-auth lookups by globally unique keys. Uses the platform connection (tenant unknown yet). */
@Injectable()
export class LoginLookup {
  constructor(private readonly db: DbService) {}

  async staffByEmail(email: string): Promise<LoginCandidate | null> {
    const [row] = await this.db.platform
      .select(candidateColumns)
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(users.email, email), eq(users.kind, 'staff')));
    return row ?? null;
  }

  async worker(orgCode: string, username: string): Promise<LoginCandidate | null> {
    const [row] = await this.db.platform
      .select(candidateColumns)
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(tenants.orgCode, orgCode), eq(users.username, username), eq(users.kind, 'worker')));
    return row ?? null;
  }
}

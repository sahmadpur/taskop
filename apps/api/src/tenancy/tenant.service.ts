import { Injectable } from '@nestjs/common';
import type { TenantDto } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { tenants } from '../db/schema';
import type { UpdateTenantDto } from './dto';

export function toTenantDto(t: typeof tenants.$inferSelect): TenantDto {
  return {
    id: t.id,
    name: t.name,
    orgCode: t.orgCode,
    timezone: t.timezone,
    locale: t.locale,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  };
}

@Injectable()
export class TenantService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<TenantDto> {
    const { tenantId } = this.db.context();
    const [row] = await this.db.tx().select().from(tenants).where(eq(tenants.id, tenantId));
    return toTenantDto(row!);
  }

  async update(input: UpdateTenantDto): Promise<TenantDto> {
    const { tenantId } = this.db.context();
    const before = await this.get();
    const [row] = await this.db
      .tx()
      .update(tenants)
      .set({ name: input.name, timezone: input.timezone, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    const after = toTenantDto(row!);
    await this.audit.record({ action: 'tenant.updated', entityType: 'tenant', entityId: tenantId, before, after });
    return after;
  }
}

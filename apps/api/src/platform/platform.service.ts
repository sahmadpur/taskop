import { Inject, Injectable } from '@nestjs/common';
import type { Page, PlatformLoginResult, PlatformTenantDto } from '@taskop/contracts';
import { and, asc, eq, gt, ilike, isNull, or, type SQL, sql } from 'drizzle-orm';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { TokenService } from '../auth/crypto/token.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { AppError } from '../common/app-error';
import { currentRequestMeta } from '../common/request-context';
import { escapeLike } from '../common/sql';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { platformAdmins, sessions, tenants } from '../db/schema';
import type { PlatformLoginDto, PlatformTenantListQueryDto } from './dto';

// Drizzle renders ${tenants.id} unqualified, which would bind to users.id inside the subquery.
const userCount = sql<number>`(select count(*)::int from users u where u.tenant_id = "tenants"."id")`;

@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: PlatformLoginDto): Promise<PlatformLoginResult> {
    await this.rateLimit.consume(`platform-login:ip:${currentRequestMeta().ip}`, this.config.RL_LOGIN_IP_PER_MIN, 60);
    const [admin] = await this.db.platform.select().from(platformAdmins).where(eq(platformAdmins.email, input.email));
    const valid = await this.hasher.verify(admin?.active ? admin.credentialHash : null, input.password);
    if (!admin || !valid) throw new AppError('INVALID_CREDENTIALS');
    const { token, expiresAt } = await this.tokens.signPlatform(admin.id);
    return { accessToken: token, accessTokenExpiresAt: expiresAt.toISOString(), admin: { id: admin.id, email: admin.email, fullName: admin.fullName } };
  }

  async listTenants(q: PlatformTenantListQueryDto): Promise<Page<PlatformTenantDto>> {
    const conditions: (SQL | undefined)[] = [];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conditions.push(or(ilike(tenants.name, like), ilike(tenants.orgCode, like)));
    }
    if (q.cursor) conditions.push(gt(tenants.id, q.cursor));
    const rows = await this.db.platform
      .select({ tenant: tenants, userCount })
      .from(tenants)
      .where(and(...conditions))
      .orderBy(asc(tenants.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map((r) => this.toDto(r.tenant, r.userCount));
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async setStatus(adminId: string, tenantId: string, status: 'active' | 'suspended'): Promise<PlatformTenantDto> {
    const [before] = await this.db.platform.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!before) throw new AppError('NOT_FOUND');
    const [row] = await this.db.platform
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ tenant: tenants, userCount });
    if (status === 'suspended') {
      await this.db.platform
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tenantId, tenantId), isNull(sessions.revokedAt)));
    }
    await this.audit.recordAsPlatform({
      tenantId,
      actorPlatformAdminId: adminId,
      action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: before.status },
      after: { status },
    });
    return this.toDto(row!.tenant, row!.userCount);
  }

  private toDto(t: typeof tenants.$inferSelect, count: number): PlatformTenantDto {
    return { id: t.id, name: t.name, orgCode: t.orgCode, status: t.status, userCount: count, createdAt: t.createdAt.toISOString() };
  }
}

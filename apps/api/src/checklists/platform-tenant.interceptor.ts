import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { from, lastValueFrom, Observable } from 'rxjs';
import { AppError } from '../common/app-error';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { AppRequest } from '../common/request';
import { DbService } from '../db/db.service';
import { tenants } from '../db/schema';

/**
 * Platform admins working inside a customer's tenant (FR-24.03): the handler runs in the normal
 * app-connection tenant transaction (RLS applies), with the admin recorded as the actor.
 */
@Injectable()
export class PlatformTenantInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const adminId = req.platformAdminId;
    if (!adminId) throw new AppError('UNAUTHENTICATED');
    const tenantId = new ParseIdPipe().transform(String(req.params.tenantId ?? ''));
    const [tenant] = await this.db.platform.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError('NOT_FOUND');
    return from(
      this.db.withTenant(tenantId, null, () => lastValueFrom(next.handle(), { defaultValue: undefined }), { platformAdminId: adminId }),
    );
  }
}

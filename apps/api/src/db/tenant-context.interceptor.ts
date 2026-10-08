import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { AppRequest } from '../common/request';
import { DbService } from './db.service';

/** Wraps every authenticated handler in one tenant transaction (commit on success, rollback on error). */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
    if (!principal) return next.handle();
    return from(
      this.db.withTenant(principal.tenantId, principal.userId, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}

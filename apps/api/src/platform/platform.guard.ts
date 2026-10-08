import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { TokenService } from '../auth/crypto/token.service';
import { AppError } from '../common/app-error';
import type { AppRequest } from '../common/request';
import { DbService } from '../db/db.service';
import { platformAdmins } from '../db/schema';

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const claims = header?.startsWith('Bearer ') ? await this.tokens.verifyPlatform(header.slice(7)) : null;
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [admin] = await this.db.platform
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.id, claims.sub), eq(platformAdmins.active, true)));
    if (!admin) throw new AppError('UNAUTHENTICATED');
    req.platformAdminId = admin.id;
    return true;
  }
}

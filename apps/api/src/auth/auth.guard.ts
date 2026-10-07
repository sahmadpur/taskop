import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/app-error';
import { IS_PUBLIC_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';
import { TokenService } from './crypto/token.service';
import { PrincipalLoader } from './principal-loader';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalLoader,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    req.principal = await this.principals.load(claims);
    return true;
  }
}

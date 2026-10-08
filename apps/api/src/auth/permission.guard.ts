import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
    if (!principal || !required.every((k) => principal.permissions.has(k))) throw new AppError('FORBIDDEN');
    return true;
  }
}

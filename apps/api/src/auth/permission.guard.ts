import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { type PermissionRequirement, REQUIRED_PERMISSIONS_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(REQUIRED_PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;
    const keys = Array.isArray(required) ? required : required.any;
    // A plain empty list asks for nothing; an empty any-of can never be satisfied.
    if (!keys.length) {
      if (Array.isArray(required)) return true;
      throw new AppError('FORBIDDEN');
    }
    const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
    const has = (k: PermissionKey) => principal?.permissions.has(k) === true;
    const ok = Array.isArray(required) ? keys.every(has) : keys.some(has);
    if (!principal || !ok) throw new AppError('FORBIDDEN');
    return true;
  }
}

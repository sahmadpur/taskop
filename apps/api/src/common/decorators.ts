import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from './app-error';
import type { AppRequest, Principal } from './request';

export const IS_PUBLIC_KEY = 'taskop:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_PERMISSIONS_KEY = 'taskop:requiredPermissions';
export const RequirePermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, keys);

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
  if (!principal) throw new AppError('UNAUTHENTICATED');
  return principal;
});

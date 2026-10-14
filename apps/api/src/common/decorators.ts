import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from './app-error';
import type { AppRequest, Principal } from './request';

export const IS_PUBLIC_KEY = 'taskop:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_PERMISSIONS_KEY = 'taskop:requiredPermissions';
/** Every key of a list is needed; with `{ any }`, one of them is enough. */
export type PermissionRequirement = PermissionKey[] | { any: PermissionKey[] };
export const RequirePermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, keys satisfies PermissionRequirement);
/** One of `keys` is enough, e.g. the run drawer: assignments.view or reports.view (SP7 spec §5.6). */
export const RequireAnyPermission = (...keys: [PermissionKey, ...PermissionKey[]]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, { any: keys } satisfies PermissionRequirement);

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
  if (!principal) throw new AppError('UNAUTHENTICATED');
  return principal;
});

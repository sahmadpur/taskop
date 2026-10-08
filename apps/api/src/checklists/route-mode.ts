import { applyDecorators, Controller, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PermissionKey } from '@taskop/contracts';
import { Public, RequirePermission } from '../common/decorators';
import { PlatformGuard } from '../platform/platform.guard';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';

export type RouteMode = 'tenant' | 'platform';

const noop: MethodDecorator = () => undefined;

/** Tenant routes check role permissions; platform admins hold every checklist permission (spec §6.2). */
export const perm = (mode: RouteMode, ...keys: PermissionKey[]): MethodDecorator => (mode === 'tenant' ? RequirePermission(...keys) : noop);

/** `path` is relative: tenant → `/<path>`, platform → `/platform/tenants/:tenantId/<path>`. */
export function controllerDecorators(mode: RouteMode, path: string, tag: string): ClassDecorator {
  return mode === 'tenant'
    ? applyDecorators(ApiTags(tag), ApiBearerAuth(), Controller(path))
    : applyDecorators(
        ApiTags('platform'),
        ApiBearerAuth(),
        Public(),
        UseGuards(PlatformGuard),
        UseInterceptors(PlatformTenantInterceptor),
        Controller(`platform/tenants/:tenantId/${path}`),
      );
}

export function named<T extends abstract new (...args: never[]) => unknown>(cls: T, name: string): T {
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}

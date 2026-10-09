import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, Principal } from '../common/request';

/** The caller: a tenant user, or null for a platform admin working inside the tenant (all scope, all permissions). */
export type Actor = Principal | null;

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest<AppRequest>().principal ?? null);

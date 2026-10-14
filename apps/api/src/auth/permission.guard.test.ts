import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionGuard } from './permission.guard';

function ctx(principal: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}
const reflector = (keys: unknown) => ({ getAllAndOverride: () => keys }) as unknown as Reflector;

describe('PermissionGuard', () => {
  it('allows routes without requirements', () => {
    expect(new PermissionGuard(reflector(undefined)).canActivate(ctx({ permissions: new Set() }))).toBe(true);
  });
  it('allows when every key is held', () => {
    expect(new PermissionGuard(reflector(['users.view'])).canActivate(ctx({ permissions: new Set(['users.view', 'x']) }))).toBe(true);
  });
  it('throws FORBIDDEN when a key is missing', () => {
    expect(() =>
      new PermissionGuard(reflector(['users.view', 'users.manage'])).canActivate(ctx({ permissions: new Set(['users.view']) })),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
  it('allows an any-of requirement when one key is held, and refuses it when none is', () => {
    const guard = new PermissionGuard(reflector({ any: ['assignments.view', 'reports.view'] }));
    expect(guard.canActivate(ctx({ permissions: new Set(['reports.view']) }))).toBe(true);
    expect(guard.canActivate(ctx({ permissions: new Set(['assignments.view']) }))).toBe(true);
    expect(() => guard.canActivate(ctx({ permissions: new Set(['users.view']) }))).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

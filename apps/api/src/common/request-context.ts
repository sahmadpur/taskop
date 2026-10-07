import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestMeta>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const userAgent = req.headers['user-agent'];
  storage.run({ ip: req.ip ?? null, userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null }, next);
}

export function currentRequestMeta(): RequestMeta {
  return storage.getStore() ?? { ip: null, userAgent: null };
}

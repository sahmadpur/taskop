import type { Response } from 'express';
import type { AppConfig } from '../config/config';
import { SESSION_TTL_MS } from './session.service';

export const REFRESH_COOKIE = 'taskop_rt';
const COOKIE_PATH = '/api/v1/auth';

export function setRefreshCookie(res: Response, token: string, config: AppConfig): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: SESSION_TTL_MS.web,
  });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict', path: COOKIE_PATH });
}

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, ErrorCode, errorMessageKey } from './index.js';

describe('errors', () => {
  it('maps every code to an HTTP status', () => {
    for (const code of Object.values(ErrorCode)) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
  it('builds message keys', () => expect(errorMessageKey('NOT_FOUND')).toBe('errors.NOT_FOUND'));
});

describe('global zod error keys', () => {
  it('turns default messages into i18n keys', () => {
    const s = z.object({ name: z.string().min(1), age: z.number().max(3), tag: z.string() });
    const issues = s.safeParse({ name: '', age: 10 }).error!.issues;
    const byPath = Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message]));
    expect(byPath).toEqual({
      name: 'errors.validation.required',
      age: 'errors.validation.tooLong',
      tag: 'errors.validation.required',
    });
  });
});

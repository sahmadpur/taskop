import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@taskop/contracts';
import { az, formatDate, formatDateTime } from './index.js';

describe('az translations', () => {
  it('has a message for every API error code', () => {
    for (const code of Object.values(ErrorCode)) expect(az.errors[code], code).toBeTypeOf('string');
  });
  it('has every validation key used by contracts', () => {
    for (const k of ['required', 'invalid', 'tooShort', 'tooLong', 'email', 'username', 'orgCode', 'pinFormat', 'pinWeak', 'passwordLength', 'timezone'] as const) {
      expect(az.errors.validation[k], k).toBeTypeOf('string');
    }
  });
});

describe('formatting', () => {
  it('formats in the tenant timezone', () => {
    expect(formatDateTime('2026-10-07T10:00:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('14:00');
  });
  it('formats dates', () => {
    expect(formatDate('2026-10-07T22:30:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('2026');
  });
});

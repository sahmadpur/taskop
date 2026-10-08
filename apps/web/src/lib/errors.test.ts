import { ApiError } from '@taskop/api-client';
import { describe, expect, it } from 'vitest';
import i18n from './i18n';
import { errorText } from './errors';

describe('errorText', () => {
  const t = i18n.t.bind(i18n);
  it('translates API errors with minutes and request ids', () => {
    expect(errorText(t, new ApiError(429, 'ACCOUNT_LOCKED', 'errors.ACCOUNT_LOCKED', null, 840))).toContain('14 dəqiqədən');
    expect(errorText(t, new ApiError(500, 'INTERNAL', 'errors.INTERNAL', null, null, 'req-7'))).toContain('req-7');
  });
  it('falls back to the internal message for unknown errors', () => {
    expect(errorText(t, new Error('x'))).toContain('Gözlənilməz xəta');
  });
});

import { ApiError } from '@taskop/api-client';
import { classifyError } from './sync-api';

describe('classifyError', () => {
  it.each<[string, unknown, string]>([
    ['a network failure', ApiError.network(), 'retry'],
    ['a 5xx', new ApiError(503, 'INTERNAL', 'errors.INTERNAL'), 'retry'],
    ['rate limiting', new ApiError(429, 'RATE_LIMITED', 'errors.RATE_LIMITED'), 'retry'],
    ['an unparseable 2xx', new ApiError(200, 'INTERNAL', 'errors.INTERNAL'), 'retry'],
    ['a non-API exception', new TypeError('boom'), 'retry'],
    ['an expired session', new ApiError(401, 'UNAUTHENTICATED', 'errors.UNAUTHENTICATED'), 'auth'],
    ['a refused command', new ApiError(422, 'CLOCK_INVALID', 'errors.CLOCK_INVALID'), 'permanent'],
    ['a validation failure', new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED'), 'permanent'],
  ])('%s', (_name, error, kind) => {
    expect(classifyError(error).kind).toBe(kind);
  });

  it('keeps the code and message key of a permanent failure', () => {
    expect(classifyError(new ApiError(409, 'EXECUTION_NOT_ACTIVE', 'errors.EXECUTION_NOT_ACTIVE'))).toEqual({
      kind: 'permanent', code: 'EXECUTION_NOT_ACTIVE', messageKey: 'errors.EXECUTION_NOT_ACTIVE',
    });
  });
});

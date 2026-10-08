import { Logger, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import '@taskop/contracts';
import { AppError } from './app-error';
import { AllExceptionsFilter, toAppError } from './error.filter';

describe('toAppError', () => {
  it('passes AppError through', () => {
    const e = new AppError('SITE_CYCLE');
    expect(toAppError(e)).toBe(e);
    expect(e.status).toBe(409);
  });

  it('maps zod validation errors to field keys', () => {
    const r = z.object({ name: z.string().min(2) }).safeParse({ name: 'a' });
    const mapped = toAppError(new ZodValidationException(r.error!));
    expect(mapped.code).toBe('VALIDATION_FAILED');
    expect(mapped.fields).toEqual({ name: 'errors.validation.tooShort' });
  });

  it('maps wrapped unique violations by constraint name', () => {
    const mapped = toAppError({ message: 'query failed', cause: { code: '23505', constraint: 'users_email_uq' } });
    expect(mapped.code).toBe('EMAIL_TAKEN');
    expect(mapped.fields).toEqual({ email: 'errors.EMAIL_TAKEN' });
  });

  it('maps foreign key violations', () => {
    expect(toAppError({ cause: { code: '23503' } }).code).toBe('REFERENCE_NOT_FOUND');
  });

  it('maps Nest HTTP exceptions', () => {
    expect(toAppError(new NotFoundException()).code).toBe('NOT_FOUND');
  });

  it('hides unknown errors', () => {
    expect(toAppError(new Error('boom')).code).toBe('INTERNAL');
  });
});

describe('AllExceptionsFilter logging', () => {
  it('does not log driver messages or parameters for unmapped DB errors', () => {
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const dbError = Object.assign(new Error('Failed query: select ... params: secret-hash'), {
      cause: { code: '42P01', detail: 'secret-hash' },
    });
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const host = { switchToHttp: () => ({ getRequest: () => ({ id: 'r1' }), getResponse: () => res }) };
    new AllExceptionsFilter().catch(dbError, host as never);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).not.toContain('secret-hash');
    expect(logged).toContain('42P01');
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});

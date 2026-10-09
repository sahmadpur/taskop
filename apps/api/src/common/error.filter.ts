import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { errorMessageKey } from '@taskop/contracts';
import { DrizzleError, DrizzleQueryError } from 'drizzle-orm';
import type { Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { AppError } from './app-error';
import { pgErrorOf, UNIQUE_CONSTRAINT_ERRORS } from './pg-errors';
import type { AppRequest } from './request';

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ZodValidationException) {
    const fields: Record<string, string> = {};
    for (const issue of (e.getZodError() as ZodError).issues) {
      const key = issue.path.map(String).join('.') || '_';
      fields[key] ??= /^(errors|scheduling)\./.test(issue.message) ? issue.message : 'errors.validation.invalid';
    }
    return new AppError('VALIDATION_FAILED', { fields });
  }
  if (e instanceof ZodSerializationException) return new AppError('INTERNAL');
  if (e instanceof HttpException) {
    const status = e.getStatus();
    if (status === 404) return new AppError('NOT_FOUND');
    if (status === 401) return new AppError('UNAUTHENTICATED');
    if (status === 403) return new AppError('FORBIDDEN');
    if (status === 400 || status === 413 || status === 415) return new AppError('VALIDATION_FAILED');
    return new AppError('INTERNAL');
  }
  const pg = pgErrorOf(e);
  if (pg?.code === '23505') {
    const mapped = UNIQUE_CONSTRAINT_ERRORS[pg.constraint ?? ''];
    if (mapped) return new AppError(mapped.code, { fields: { [mapped.field]: errorMessageKey(mapped.code) } });
  }
  if (pg?.code === '23503') return new AppError('REFERENCE_NOT_FOUND');
  return new AppError('INTERNAL');
}

const isDrizzleError = (e: Error): boolean =>
  e instanceof DrizzleQueryError || e instanceof DrizzleError || e.message.startsWith('Failed query:');

/** Never log driver/ORM errors verbatim: their messages embed SQL and bound parameters. */
export function sanitiseForLog(exception: unknown, requestId: string | null): Record<string, unknown> {
  const pg = pgErrorOf(exception);
  const error = exception instanceof Error ? exception : null;
  const sensitive = pg !== null || (error !== null && isDrizzleError(error));
  const payload: Record<string, unknown> = {
    requestId,
    errorName: error?.name ?? typeof exception,
    pgCode: pg?.code ?? null,
    pgConstraint: pg?.constraint ?? null,
  };
  if (!sensitive && error) payload.message = error.message;
  if (error?.stack) {
    payload.stack = sensitive ? error.stack.split('\n').filter((l) => l.trimStart().startsWith('at ')).join('\n') : error.stack;
  }
  return payload;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const requestId = req.id ? String(req.id) : null;
    const err = toAppError(exception);
    if (err.code === 'INTERNAL') {
      this.logger.error(sanitiseForLog(exception, requestId), 'Unhandled error');
    }
    if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
    res.status(err.status).json({
      error: {
        code: err.code,
        messageKey: errorMessageKey(err.code),
        fields: err.fields,
        retryAfterSeconds: err.retryAfterSeconds,
        requestId,
        ...(err.details ?? {}),
      },
    });
  }
}

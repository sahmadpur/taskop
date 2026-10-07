import { ERROR_HTTP_STATUS, type ErrorCode } from '@taskop/contracts';

export class AppError extends Error {
  readonly fields: Record<string, string> | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    readonly code: ErrorCode,
    opts: { fields?: Record<string, string>; retryAfterSeconds?: number; message?: string } = {},
  ) {
    super(opts.message ?? code);
    this.fields = opts.fields ?? null;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

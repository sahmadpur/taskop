import { type ContentIssue, ERROR_HTTP_STATUS, type ErrorCode } from '@taskop/contracts';

export interface AppErrorDetails {
  issues?: ContentIssue[];
  currentRevision?: number;
  /** Users that caused the error (e.g. ASSIGNEE_NOT_AT_SITE). */
  userIds?: string[];
}

export class AppError extends Error {
  readonly fields: Record<string, string> | null;
  readonly retryAfterSeconds: number | null;
  readonly details: AppErrorDetails | null;

  constructor(
    readonly code: ErrorCode,
    opts: { fields?: Record<string, string>; retryAfterSeconds?: number; message?: string; details?: AppErrorDetails } = {},
  ) {
    super(opts.message ?? code);
    this.fields = opts.fields ?? null;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.details = opts.details ?? null;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

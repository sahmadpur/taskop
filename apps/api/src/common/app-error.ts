import { type ContentIssue, ERROR_HTTP_STATUS, type ErrorCode, type Missing } from '@taskop/contracts';

export interface AppErrorDetails {
  issues?: ContentIssue[];
  currentRevision?: number;
  /** Users that caused the error (e.g. ASSIGNEE_NOT_AT_SITE). */
  userIds?: string[];
  /** REQUIREMENTS_UNMET: what still blocks completion. */
  missing?: Missing[];
  /** REPORT_TOO_LARGE: the rows the export would have, and the cap (SP7 spec §5.4). */
  rows?: number;
  limit?: number;
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

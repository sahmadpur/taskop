import type { ContentIssue, ErrorCode, Missing } from '@taskop/contracts';

export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    readonly messageKey: string,
    readonly fields: Record<string, string> | null = null,
    readonly retryAfterSeconds: number | null = null,
    readonly requestId: string | null = null,
    readonly issues: ContentIssue[] | null = null,
    readonly currentRevision: number | null = null,
    /** Users an error is about (ASSIGNEE_NOT_AT_SITE, ASSIGNEE_INACTIVE, ROSTER_USER_NOT_AT_SITE). */
    readonly userIds: string[] | null = null,
    /** REQUIREMENTS_UNMET: what still blocks completion. */
    readonly missing: Missing[] | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  static network(): ApiError {
    return new ApiError(0, 'NETWORK', 'errors.NETWORK');
  }
}

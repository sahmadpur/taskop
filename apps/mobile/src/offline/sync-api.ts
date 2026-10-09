import { ApiError, type ExecutionsApi } from '@taskop/api-client';

/** The slice of the API client the offline layer uses (Part 1 Task 5). `api` from '@/lib/session' satisfies it. */
export interface SyncApi {
  sync: Pick<ExecutionsApi['sync'], 'pull'>;
  executions: Pick<ExecutionsApi['executions'], 'claim' | 'saveAnswers' | 'complete' | 'registerMedia'>;
  media: Pick<ExecutionsApi['media'], 'confirmUploaded'>;
}

export type Failure = { kind: 'retry' } | { kind: 'auth' } | { kind: 'permanent'; code: string; messageKey: string };

/**
 * Spec §7.2: network errors and 5xx stop the run and retry with backoff; any other 4xx is permanent for that command.
 * 401 means the API client's refresh was rejected: wait for a new session instead of parking the command (decision 5).
 */
export function classifyError(e: unknown): Failure {
  if (!(e instanceof ApiError)) return { kind: 'retry' };
  if (e.status === 401) return { kind: 'auth' };
  if (e.code === 'NETWORK' || e.code === 'INTERNAL' || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500) {
    return { kind: 'retry' };
  }
  return { kind: 'permanent', code: e.code, messageKey: e.messageKey };
}

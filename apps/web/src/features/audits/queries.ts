import { ApiError } from '@taskop/api-client';
import type { AuditDetail } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/session';
import { type AuditQueueFilters, REPORT_POLL_LIMIT_MS, REPORT_POLL_MS } from './labels';

export const auditKeys = {
  /** Every audit query: invalidated by refreshRunViews. */
  all: ['audits'] as const,
  queue: (f: AuditQueueFilters) => ['audits', 'queue', f] as const,
  detail: (id: string) => ['audits', 'detail', id] as const,
};

/** Pages of 50 in the API's order for the queue (Part 1 decision 13); "Daha çox göstər" passes nextCursor back. */
export const useAuditQueue = (filters: AuditQueueFilters, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: auditKeys.queue(filters),
    queryFn: ({ pageParam }) => api.audits.list({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

/** The auditor filter's options: active staff (Gap 1). Needs users.view. */
export const useAuditorOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ['users', 'auditor-options'],
    queryFn: async () => (await api.users.list({ kind: 'staff', status: 'active', limit: 200 })).items,
    enabled,
    staleTime: 5 * 60_000,
  });

const reportPending = (a: AuditDetail | undefined): boolean => a?.status === 'finished' && a.reportStatus === 'pending';

/**
 * GET /audits/:id. While a finished audit's report is being built it is asked again every 3 s, for at most 60 s; then
 * `timedOut` is true until `restartPolling()` opens a new window (decision 9).
 */
export function useAuditDetail(id: string) {
  const [round, setRound] = useState(0);
  const [expiredRound, setExpiredRound] = useState<number | null>(null);
  const allowPoll = expiredRound !== round;
  const query = useQuery({
    queryKey: auditKeys.detail(id),
    queryFn: () => api.audits.get(id),
    refetchInterval: (q) => (allowPoll && reportPending(q.state.data) ? REPORT_POLL_MS : false),
  });
  const pending = reportPending(query.data);
  useEffect(() => {
    if (!pending || !allowPoll) return;
    const timer = setTimeout(() => setExpiredRound(round), REPORT_POLL_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [pending, allowPoll, round]);
  return { query, timedOut: pending && !allowPoll, restartPolling: () => setRound((r) => r + 1) };
}

/** POST /executions/:id/audits; when another auditor was first (AUDIT_EXISTS) their audit is opened (decision 4). */
export async function startOrOpenAudit(executionId: string): Promise<string> {
  try {
    return (await api.audits.start(executionId)).id;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'AUDIT_EXISTS' && e.auditId) return e.auditId;
    throw e;
  }
}

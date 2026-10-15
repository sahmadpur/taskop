import { ApiError } from '@taskop/api-client';
import type { LocalDate, ReportFiltersQuery, RunBucket } from '@taskop/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, session } from '@/lib/session';

/** Team data this young counts as fresh (decision 7): switching chips back and forth reuses it. */
export const TEAM_STALE_MS = 30_000;

export interface TeamFilters {
  from: LocalDate;
  to: LocalDate;
  /** The picked employee; null = everyone in the viewer's scope. */
  userId: string | null;
}

/**
 * Every key starts with the viewer (decision 7): the app has one QueryClient for its whole life, so another manager
 * signing in on this phone must never be served this one's cache. The tab's own queries share `list`.
 */
export const teamKeys = {
  all: (viewerId: string) => ['team', viewerId] as const,
  list: (viewerId: string) => ['team', viewerId, 'list'] as const,
  summary: (viewerId: string, f: TeamFilters) => ['team', viewerId, 'list', 'summary', f.from, f.to, f.userId] as const,
  employees: (viewerId: string, from: LocalDate, to: LocalDate) => ['team', viewerId, 'list', 'employees', from, to] as const,
  runs: (viewerId: string, f: TeamFilters, bucket: RunBucket) => ['team', viewerId, 'list', 'runs', f.from, f.to, f.userId, bucket] as const,
  occurrence: (viewerId: string, id: string) => ['team', viewerId, 'run', 'occurrence', id] as const,
  execution: (viewerId: string, id: string) => ['team', viewerId, 'run', 'execution', id] as const,
  audit: (viewerId: string, id: string) => ['team', viewerId, 'run', 'audit', id] as const,
  corrections: (viewerId: string, executionId: string) => ['team', viewerId, 'run', 'corrections', executionId] as const,
};

/** The shared report filters (Part 1 `reportFiltersSchema`); `userId` only when someone is picked. */
export const filterQuery = (f: TeamFilters): ReportFiltersQuery => (f.userId ? { from: f.from, to: f.to, userId: f.userId } : { from: f.from, to: f.to });

/** Decision 7: no automatic retries (the user has a retry button; a timed-out report already cost the server 15 s). */
const common = { retry: false, staleTime: TEAM_STALE_MS } as const;

/** GET /reports/summary: the tiles. They follow the employee, not the status chip (decision 4). */
export const useTeamSummary = (viewerId: string, f: TeamFilters, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.summary(viewerId, f), queryFn: () => api.reports.summary(filterQuery(f)), enabled, ...common });

/** GET /reports/employees for the period only: the picker's list never shrinks to the person picked (decision 4). */
export const useTeamEmployees = (viewerId: string, from: LocalDate, to: LocalDate, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.employees(viewerId, from, to), queryFn: () => api.reports.employees({ from, to }), enabled, ...common });

/** GET /reports/runs, 50 a page; `nextCursor` goes back as `cursor` with the same filters. */
export const useTeamRuns = (viewerId: string, f: TeamFilters, bucket: RunBucket, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: teamKeys.runs(viewerId, f, bucket),
    queryFn: ({ pageParam }) => api.reports.runs({ ...filterQuery(f), bucket, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    ...common,
  });

/** GET /occurrences/:id: the run screen's header (decision 10). Part 1 Task 7 lets reports.view read it. */
export const useTeamOccurrence = (viewerId: string, occurrenceId: string, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.occurrence(viewerId, occurrenceId), queryFn: () => api.occurrences.get(occurrenceId), enabled, ...common });

/** GET /executions/:id: the answers and problems, only for a run that has an execution. */
export const useTeamExecution = (viewerId: string, executionId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: teamKeys.execution(viewerId, executionId ?? ''),
    queryFn: () => api.executions.get(executionId!),
    enabled: enabled && executionId !== null,
    ...common,
  });

/** GET /audits/:id (SP8): the audit with its verdicts and the run as it is now. */
export const useTeamAudit = (viewerId: string, auditId: string, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.audit(viewerId, auditId), queryFn: () => api.audits.get(auditId), enabled, ...common });

/** GET /executions/:id/corrections (SP8): the corrections timeline, only for a run that has an execution. */
export const useTeamCorrections = (viewerId: string, executionId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: teamKeys.corrections(viewerId, executionId ?? ''),
    queryFn: () => api.corrections.history(executionId!),
    enabled: enabled && executionId !== null,
    ...common,
  });

export type CommandResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface RunCommand {
  /** Null when another action of this screen is still in flight (a second tap does nothing). */
  run<T>(job: () => Promise<T>, o?: { refresh?: boolean }): Promise<CommandResult<T> | null>;
  busy: boolean;
  /** The last failure, for the screen to show; cleared by the next action. */
  error: unknown;
  clearError(): void;
}

/**
 * The Team run screen's server actions (audit, verdict, correction, send-back, withdraw): one at a time. A success
 * refreshes every team query of the viewer (the run's status, its execution and audit, the list's buckets) unless
 * `refresh: false` (a verdict updates the cached audit itself).
 */
export function useRunCommand(viewerId: string): RunCommand {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async <T>(job: () => Promise<T>, o: { refresh?: boolean } = {}): Promise<CommandResult<T> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const value = await job();
        if (o.refresh !== false) await client.invalidateQueries({ queryKey: teamKeys.all(viewerId) });
        return { ok: true, value };
      } catch (e) {
        setError(e);
        return { ok: false, error: e };
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client, viewerId],
  );
  const clearError = useCallback(() => setError(null), []);
  return { run, busy, error, clearError };
}

/**
 * Decision 9: a 403 means the role changed after the profile was cached. Refreshing it lets the tab and the routes follow
 * (decision 1). Once per mounted screen: the header's queries fail together. A failed refresh is only logged.
 */
export function useRefreshMeOnForbidden(errors: readonly unknown[]): void {
  const asked = useRef(false);
  const forbidden = errors.some((e) => e instanceof ApiError && e.code === 'FORBIDDEN');
  useEffect(() => {
    if (!forbidden || asked.current) return;
    asked.current = true;
    session.refreshMe().catch((e: unknown) => console.warn('[team] Could not refresh the profile', e instanceof Error ? e.message : 'unknown error'));
  }, [forbidden]);
}

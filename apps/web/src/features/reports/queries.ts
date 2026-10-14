import type { ChecklistSummary, ProblemSeverity, ReportFilters, RunBucket } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

/** Spec §6.1: the dashboard asks again every minute while it is visible. */
export const DASHBOARD_REFETCH_MS = 60_000;
/** "Needs attention" shows the first 10 of each list (Part 1 decision 13). */
export const ATTENTION_LIMIT = 10;

export const reportKeys = {
  /** Every report query: invalidated by "Yenilə" and when a report's drawer closes. */
  all: ['reports'] as const,
  summary: (f: ReportFilters) => ['reports', 'summary', f] as const,
  sites: (f: ReportFilters) => ['reports', 'sites', f] as const,
  employees: (f: ReportFilters) => ['reports', 'employees', f] as const,
  runs: (f: ReportFilters, bucket: RunBucket) => ['reports', 'runs', f, bucket] as const,
  problems: (f: ReportFilters, severity: ProblemSeverity | null) => ['reports', 'problems', f, severity] as const,
  tasks: (f: ReportFilters) => ['reports', 'tasks', f] as const,
  overdueNow: (f: ReportFilters) => ['reports', 'attention', 'overdue', f] as const,
  critical: (f: ReportFilters) => ['reports', 'attention', 'critical', f] as const,
};

/** Polling only while the tab is visible, and once more when the window gets focus back (decision 10). */
const LIVE = { refetchInterval: DASHBOARD_REFETCH_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true } as const;

/** `filters` is null while the filter bar shows a range the API would refuse: nothing is asked. */
export const useReportSummary = (filters: ReportFilters | null, o: { live?: boolean } = {}) =>
  useQuery({
    queryKey: reportKeys.summary(filters!),
    queryFn: () => api.reports.summary(filters!),
    enabled: filters !== null,
    ...(o.live ? LIVE : {}),
  });

export const useSiteReport = (filters: ReportFilters) => useQuery({ queryKey: reportKeys.sites(filters), queryFn: () => api.reports.sites(filters) });

export const useEmployeeReport = (filters: ReportFilters) =>
  useQuery({ queryKey: reportKeys.employees(filters), queryFn: () => api.reports.employees(filters) });

/** Pages of 50, newest due first; "Daha çox göstər" passes nextCursor back with the same filters. */
export const useReportRuns = (filters: ReportFilters, bucket: RunBucket) =>
  useInfiniteQuery({
    queryKey: reportKeys.runs(filters, bucket),
    queryFn: ({ pageParam }) => api.reports.runs({ ...filters, bucket, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** The counts come with every page and cover the whole filtered set (Part 1 decision 12): read them from the first. */
export const useReportProblems = (filters: ReportFilters, severity: ProblemSeverity | null) =>
  useInfiniteQuery({
    queryKey: reportKeys.problems(filters, severity),
    queryFn: ({ pageParam }) => api.reports.problems({ ...filters, ...(severity ? { severity } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useReportTasks = (filters: ReportFilters) =>
  useInfiniteQuery({
    queryKey: reportKeys.tasks(filters),
    queryFn: ({ pageParam }) => api.reports.tasks({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Runs overdue right now: today's, whatever the period, with the other filters (decision 9). */
export function useOverdueNow(filters: ReportFilters | null, today: string) {
  const query = filters ? { ...filters, from: today, to: today } : null;
  return useQuery({
    queryKey: reportKeys.overdueNow(query!),
    queryFn: () => api.reports.runs({ ...query!, bucket: 'overdue' }),
    enabled: query !== null,
    select: (p) => p.items.slice(0, ATTENTION_LIMIT),
    ...LIVE,
  });
}

/** Critical problems of the period (Part 1 decision 5). */
export const useCriticalProblems = (filters: ReportFilters | null) =>
  useQuery({
    queryKey: reportKeys.critical(filters!),
    queryFn: () => api.reports.problems({ ...filters!, severity: 'critical' }),
    enabled: filters !== null,
    select: (p) => p.items.slice(0, ATTENTION_LIMIT),
    ...LIVE,
  });

/** The employee picker: the period's employee report without its own filter (decision 4); shares the tab's cache. */
export function useEmployeeOptions(filters: ReportFilters | null) {
  const query: ReportFilters | null = filters
    ? { from: filters.from, to: filters.to, ...(filters.siteId ? { siteId: filters.siteId } : {}), ...(filters.checklistId ? { checklistId: filters.checklistId } : {}) }
    : null;
  return useQuery({
    queryKey: reportKeys.employees(query!),
    queryFn: () => api.reports.employees(query!),
    enabled: query !== null,
    staleTime: 5 * 60_000,
  });
}

/** Every checklist, deactivated ones included (the picker filters them), following nextCursor. */
export const useReportChecklistOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ['checklists', 'report-options'],
    queryFn: async () => {
      const all: ChecklistSummary[] = [];
      let cursor: string | undefined;
      do {
        const p = await api.checklists.list({ limit: 200, ...(cursor ? { cursor } : {}) });
        all.push(...p.items);
        cursor = p.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

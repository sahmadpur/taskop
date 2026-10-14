import { ApiError } from '@taskop/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ME, OCC, OCC2 } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import {
  filterQuery,
  teamKeys,
  type TeamFilters,
  useRefreshMeOnForbidden,
  useTeamEmployees,
  useTeamExecution,
  useTeamOccurrence,
  useTeamRuns,
  useTeamSummary,
} from './queries';
import { counts, employeeRow, EXECUTION, occurrenceDetail, reportRun, reportSummary, RUN_CURSOR, runPage, VIEWER2, WORKER_A } from './testing/fixtures';
import { gate, testQueryClient } from './testing/render';

const mockSummary = jest.fn();
const mockEmployees = jest.fn();
const mockRuns = jest.fn();
const mockOccurrence = jest.fn();
const mockExecution = jest.fn();
const mockRefreshMe = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    reports: {
      summary: (...a: unknown[]) => mockSummary(...a),
      employees: (...a: unknown[]) => mockEmployees(...a),
      runs: (...a: unknown[]) => mockRuns(...a),
    },
    occurrences: { get: (...a: unknown[]) => mockOccurrence(...a) },
    executions: { get: (...a: unknown[]) => mockExecution(...a) },
  },
  session: { refreshMe: () => mockRefreshMe() },
}));

const TODAY: TeamFilters = { from: '2026-11-02', to: '2026-11-02', userId: null };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN');

async function hook<R, P>(fn: (props: P) => R, o: { initialProps?: P; client?: QueryClient } = {}) {
  const client = o.client ?? testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...(await renderHook(fn, { wrapper, initialProps: o.initialProps as P })), client };
}

beforeEach(() => jest.clearAllMocks());

describe('team queries', () => {
  it('sends the period, and the employee only when one is chosen', () => {
    expect(filterQuery(TODAY)).toStrictEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(filterQuery({ ...TODAY, userId: WORKER_A })).toStrictEqual({ from: '2026-11-02', to: '2026-11-02', userId: WORKER_A });
  });

  it('loads the summary and the period’s employees', async () => {
    mockSummary.mockResolvedValue(reportSummary({ counts: counts({ completed: 7 }) }));
    mockEmployees.mockResolvedValue([employeeRow()]);
    const s = await hook(() => useTeamSummary(ME, { ...TODAY, userId: WORKER_A }, true));
    const e = await hook(() => useTeamEmployees(ME, '2026-10-27', '2026-11-02', true));
    await eventually(async () => expect(s.result.current.data?.counts.completed).toBe(7));
    await eventually(async () => expect(e.result.current.data).toEqual([employeeRow()]));
    expect(mockSummary).toHaveBeenCalledWith({ from: '2026-11-02', to: '2026-11-02', userId: WORKER_A });
    expect(mockEmployees).toHaveBeenCalledWith({ from: '2026-10-27', to: '2026-11-02' });
  });

  it('asks nothing while disabled (offline)', async () => {
    const s = await hook(() => useTeamSummary(ME, TODAY, false));
    await hook(() => useTeamRuns(ME, TODAY, 'all', false));
    await settle();
    expect(mockSummary).not.toHaveBeenCalled();
    expect(mockRuns).not.toHaveBeenCalled();
    expect(s.result.current.fetchStatus).toBe('idle');
  });

  it('keeps each viewer’s data apart on one client', async () => {
    const second = gate();
    mockSummary
      .mockResolvedValueOnce(reportSummary({ counts: counts({ completed: 7 }) }))
      .mockImplementationOnce(async () => {
        await second.opened;
        return reportSummary({ counts: counts({ completed: 1 }) });
      });
    const h = await hook(({ viewer }: { viewer: string }) => useTeamSummary(viewer, TODAY, true), { initialProps: { viewer: ME } });
    await eventually(async () => expect(h.result.current.data?.counts.completed).toBe(7));
    await h.rerender({ viewer: VIEWER2 });
    // Manager B, signed in on the same phone, never sees manager A's numbers, not even while B's own load is running.
    expect(h.result.current.data).toBeUndefined();
    await act(async () => second.open());
    await eventually(async () => expect(h.result.current.data?.counts.completed).toBe(1));
    expect(teamKeys.summary(VIEWER2, TODAY).slice(0, 3)).toEqual(['team', VIEWER2, 'list']);
  });

  it('pages the runs with the cursor and stops at the last page', async () => {
    mockRuns.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? runPage([reportRun({ occurrenceId: OCC2 })]) : runPage([reportRun()], RUN_CURSOR)));
    const h = await hook(() => useTeamRuns(ME, TODAY, 'overdue', true));
    await eventually(async () => expect(h.result.current.hasNextPage).toBe(true));
    await act(async () => {
      await h.result.current.fetchNextPage();
    });
    expect(mockRuns.mock.calls.map(([q]) => q)).toEqual([
      { from: '2026-11-02', to: '2026-11-02', bucket: 'overdue' },
      { from: '2026-11-02', to: '2026-11-02', bucket: 'overdue', cursor: RUN_CURSOR },
    ]);
    await eventually(async () => expect(h.result.current.hasNextPage).toBe(false));
    expect(h.result.current.data?.pages.flatMap((p) => p.items.map((r) => r.occurrenceId))).toEqual([OCC, OCC2]);
  });

  it('does not retry a failed report by itself, even where the app’s client would', async () => {
    // The app's client retries once (app/_layout.tsx); a report that timed out already cost the server 15 s.
    const appLike = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: Infinity } } });
    mockSummary.mockRejectedValue(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    const h = await hook(() => useTeamSummary(ME, TODAY, true), { client: appLike });
    await eventually(async () => expect(h.result.current.error).toMatchObject({ code: 'REPORT_TIMEOUT' }));
    await settle();
    expect(mockSummary).toHaveBeenCalledTimes(1);
  });

  it('loads a run’s occurrence, and its execution only once there is one', async () => {
    mockOccurrence.mockResolvedValue(occurrenceDetail());
    mockExecution.mockResolvedValue({ id: EXECUTION });
    const o = await hook(() => useTeamOccurrence(ME, OCC, true));
    await eventually(async () => expect(o.result.current.data?.id).toBe(OCC));
    expect(mockOccurrence).toHaveBeenCalledWith(OCC);
    const none = await hook(() => useTeamExecution(ME, null, true));
    await settle();
    expect(mockExecution).not.toHaveBeenCalled();
    expect(none.result.current.fetchStatus).toBe('idle');
    await hook(() => useTeamExecution(ME, EXECUTION, true));
    await eventually(async () => expect(mockExecution).toHaveBeenCalledWith(EXECUTION));
  });

  it('refreshes the profile once after a 403, never for other errors', async () => {
    mockRefreshMe.mockResolvedValue(undefined);
    const timeout = new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT');
    const h = await hook(({ errors }: { errors: unknown[] }) => useRefreshMeOnForbidden(errors), { initialProps: { errors: [timeout, null] } });
    expect(mockRefreshMe).not.toHaveBeenCalled();
    await h.rerender({ errors: [forbidden(), forbidden()] });
    await h.rerender({ errors: [null] });
    await h.rerender({ errors: [forbidden()] });
    expect(mockRefreshMe).toHaveBeenCalledTimes(1);
  });

  it('logs a failed profile refresh instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRefreshMe.mockRejectedValue(ApiError.network());
    await hook(() => useRefreshMeOnForbidden([forbidden()]));
    await eventually(async () => expect(warn).toHaveBeenCalledWith('[team] Could not refresh the profile', 'NETWORK'));
    warn.mockRestore();
  });
});

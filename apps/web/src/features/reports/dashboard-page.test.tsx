import { ApiError } from '@taskop/api-client';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { queryClient as appQueryClient } from '@/lib/query';
import { renderWithRouter } from '@/test/router';
import { fixedSizeCharts } from './chart-test-setup';
import { DashboardPage } from './dashboard-page';
import { CHECKLISTS, completedRun, EMPLOYEE_ROWS, IDS, meWith, page, reportProblem, reportProblems, reportRun, reportSummary, SITES, TODAY, VIEWER } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    reports: { summary: vi.fn(), employees: vi.fn(), runs: vi.fn(), problems: vi.fn() },
    sites: { list: vi.fn() },
    checklists: { list: vi.fn() },
    occurrences: { get: vi.fn(), cancel: vi.fn() },
    executions: { get: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

vi.mock('recharts', async (original) => fixedSizeCharts(await original<object>()));

/** The app's own query defaults (30 s stale, no focus refetch), so these tests pin the dashboard's overrides. */
const appClient = () => new QueryClient({ defaultOptions: { ...appQueryClient.getDefaultOptions(), queries: { ...appQueryClient.getDefaultOptions().queries, retry: false } } });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.reports.summary.mockResolvedValue(reportSummary());
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
  mocks.api.reports.runs.mockResolvedValue(page([reportRun()]));
  mocks.api.reports.problems.mockResolvedValue(reportProblems([reportProblem()]));
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('DashboardPage', () => {
  it("shows today's tiles and what needs attention: the first 10 overdue runs of today and the period's critical problems", async () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      reportRun({ occurrenceId: `0192f1e2-7c3a-7b4d-8e5f-${(0x100 + i).toString(16).padStart(12, '0')}`, checklist: { id: IDS.checklist, name: `Yoxlama ${i + 1}` } }),
    );
    mocks.api.reports.runs.mockResolvedValue(page(runs, runs[11]!.occurrenceId));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByRole('heading', { name: 'İdarə paneli' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Planlaşdırılıb: 12' })).toBeInTheDocument();
    for (const name of ['Tamamlanıb: 7', 'Davam edir: 1', 'Gecikib: 1', 'Problemli: 2']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tamamlanma faizi' })).toHaveTextContent('70%');
    expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: TODAY, to: TODAY });
    // One day: no trend.
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();

    const overdue = await screen.findByRole('list', { name: 'Hazırda gecikən icralar' });
    expect(within(overdue).getAllByRole('listitem')).toHaveLength(10);
    expect(overdue).toHaveTextContent('Yoxlama 1');
    expect(overdue).not.toHaveTextContent('Yoxlama 11');
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: TODAY, to: TODAY, bucket: 'overdue' });
    const critical = screen.getByRole('list', { name: 'Kritik problemlər' });
    expect(critical).toHaveTextContent('Soyuducunun temperaturu');
    expect(critical).toHaveTextContent('Kondisioner xarabdır');
    expect(mocks.api.reports.problems).toHaveBeenCalledWith({ from: TODAY, to: TODAY, severity: 'critical' });
  });

  it("keeps the overdue list on today while the period and filters apply to the rest", async () => {
    renderWithRouter(<DashboardPage today={TODAY} />, `/?period=last_7&siteId=${IDS.zoneA}`);
    expect(await screen.findByRole('figure', { name: 'Gündəlik icra' })).toBeInTheDocument();
    expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA });
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: TODAY, to: TODAY, siteId: IDS.zoneA, bucket: 'overdue' }));
    expect(mocks.api.reports.problems).toHaveBeenCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA, severity: 'critical' });
    // A tile carries the dashboard's filters to the runs report.
    const href = new URL(screen.getByRole('link', { name: 'Gecikib: 1' }).getAttribute('href')!, 'http://localhost');
    expect(Object.fromEntries(href.searchParams)).toEqual({ period: 'last_7', siteId: IDS.zoneA, tab: 'runs', bucket: 'overdue' });
  });

  it('keeps the filters in the URL of the home page', async () => {
    const router = renderWithRouter(<DashboardPage today={TODAY} />);
    await userEvent.selectOptions(await screen.findByLabelText('Dövr'), 'this_month');
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'this_month' }));
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-11-01', to: TODAY }));
  });

  it("resolves the period from the tenant's today, not the browser's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 01:30 on 5 November in Baku; 16:30 on 4 November in New York.
    vi.setSystemTime(new Date('2026-11-04T21:30:00Z'));
    renderWithRouter(<DashboardPage />, '/?period=this_week');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-11-02', to: '2026-11-05' }));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: '2026-11-05', to: '2026-11-05', bucket: 'overdue' }));
    cleanup();
    mocks.me.current = meWith(VIEWER, { timezone: 'America/New_York' });
    renderWithRouter(<DashboardPage />, '/?period=this_week');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-11-02', to: '2026-11-04' }));
  });

  it('asks again every minute while the page is visible, not while it is hidden, and at once when it comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithRouter(<DashboardPage today={TODAY} />, '/', appClient());
    await screen.findByRole('link', { name: 'Gecikib: 1' });
    await waitFor(() => expect(mocks.api.reports.problems).toHaveBeenCalledTimes(1));
    expect(mocks.api.reports.summary).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.api.reports.problems).toHaveBeenCalledTimes(2));

    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(mocks.api.reports.summary).toHaveBeenCalledTimes(2);
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledTimes(3));
  });

  it('moves Today to the new day when the page stays open over midnight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 23:59:30 in Baku.
    vi.setSystemTime(new Date('2026-11-04T19:59:30Z'));
    renderWithRouter(<DashboardPage />, '/', appClient());
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-11-04', to: '2026-11-04' }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-11-05', to: '2026-11-05' }));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenLastCalledWith({ from: '2026-11-05', to: '2026-11-05', bucket: 'overdue' }));
  });

  it('refreshes on demand and says when the numbers were last updated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 12:15 in Baku.
    vi.setSystemTime(new Date('2026-11-04T08:15:00Z'));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByText('Son yenilənmə: 12:15')).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-11-04T08:17:00Z'));
    await userEvent.click(screen.getByRole('button', { name: 'Yenilə' }));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Son yenilənmə: 12:17')).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledTimes(2));
  });

  it('opens an overdue run on its overview and a critical problem on the execution tab', async () => {
    mocks.api.reports.problems.mockResolvedValue(reportProblems([reportProblem({ occurrenceId: completedRun().occurrenceId })]));
    renderWithRouter(<DashboardPage today={TODAY} />);
    const overdue = await screen.findByRole('list', { name: 'Hazırda gecikən icralar' });
    await userEvent.click(within(overdue).getByRole('button', { name: /Açılış yoxlaması/ }));
    const first = await screen.findByRole('dialog');
    expect(await within(first).findByRole('tab', { name: 'Ümumi' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run);
    await userEvent.click(within(first).getByRole('button', { name: 'Bağla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getByRole('list', { name: 'Kritik problemlər' })).getByRole('button', { name: /Soyuducunun temperaturu/ }));
    const second = await screen.findByRole('dialog');
    expect(await within(second).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenLastCalledWith(IDS.run2);
  });

  it('says so when nothing needs attention', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([]));
    mocks.api.reports.problems.mockResolvedValue(reportProblems([], { counts: { total: 0, critical: 0, resolution: { none: 0, open: 0, resolved: 0, cancelled: 0 } } }));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByText('Hazırda gecikən icra yoxdur.')).toBeInTheDocument();
    expect(await screen.findByText('Bu dövrdə kritik problem yoxdur.')).toBeInTheDocument();
  });

  it('shows why the numbers could not be loaded', async () => {
    mocks.api.reports.summary.mockRejectedValue(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByText('Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.')).toBeInTheDocument();
  });
});

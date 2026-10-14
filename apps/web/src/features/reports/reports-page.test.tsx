import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { fixedSizeCharts } from './chart-test-setup';
import { CHECKLISTS, EMPLOYEE_ROWS, IDS, meWith, page, reportProblems, reportSummary, reportTasks, SITE_ROWS, SITES, TODAY, VIEWER } from './fixtures';
import { ReportsPage } from './reports-page';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    reports: { summary: vi.fn(), sites: vi.fn(), employees: vi.fn(), runs: vi.fn(), problems: vi.fn(), tasks: vi.fn(), export: vi.fn() },
    sites: { list: vi.fn() },
    checklists: { list: vi.fn() },
    occurrences: { get: vi.fn() },
    tasks: { get: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));
vi.mock('recharts', async (original) => fixedSizeCharts(await original<object>()));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.reports.summary.mockResolvedValue(reportSummary());
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
  // Every tab has an answer, so switching tabs in a test never leaves a query without data.
  mocks.api.reports.sites.mockResolvedValue([]);
  mocks.api.reports.runs.mockResolvedValue(page([]));
  mocks.api.reports.problems.mockResolvedValue(reportProblems([]));
  mocks.api.reports.tasks.mockResolvedValue(reportTasks([]));
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
});

describe('ReportsPage', () => {
  it('opens on Summary and keeps the filters, the tab and the bucket in the URL', async () => {
    const router = renderWithRouter(<ReportsPage today={TODAY} />, `/reports?period=this_week&siteId=${IDS.zoneA}&inactive=true`);
    expect(await screen.findByRole('link', { name: 'Gecikib: 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hesabatlar' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Xülasə' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-11-02', to: TODAY, siteId: IDS.zoneA });
    // Summary adds the partial and missed tiles, and a multi-day period has its trend.
    expect(screen.getByRole('link', { name: 'Yarımçıq: 1' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Gündəlik icra' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Dövr'), 'last_7');
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true }));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA }));

    // A tile opens the runs tab with its bucket and the same filters.
    await userEvent.click(screen.getByRole('link', { name: 'Gecikib: 1' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true, tab: 'runs', bucket: 'overdue' }));
    expect(screen.getByRole('tab', { name: 'İcralar' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Obyektlər' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true, tab: 'sites', bucket: 'overdue' }));
  });

  it('reopens a shared URL on its tab', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=problems&severity=critical&period=yesterday');
    expect(await screen.findByRole('tab', { name: 'Problemlər' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Dövr')).toHaveValue('yesterday');
  });

  it('explains a custom range it cannot show and asks for no report', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?period=custom&from=2026-10-31&to=2026-10-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('Son tarix başlanğıc tarixindən əvvəl ola bilməz.');
    expect(mocks.api.reports.summary).not.toHaveBeenCalled();
  });

  it('falls back to Summary without a broken site id from a hand-edited URL', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=audit&siteId=site-1&bucket=late');
    expect(await screen.findByRole('tab', { name: 'Xülasə' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: TODAY, to: TODAY }));
  });

  it('drills down from a site row to its Summary, keeps the period, and Back returns to the sites', async () => {
    mocks.api.reports.sites.mockResolvedValue(SITE_ROWS);
    const router = renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=sites&period=last_7');
    await userEvent.click(await screen.findByRole('button', { name: 'Zona A1' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', tab: 'summary', siteId: IDS.zoneA }));
    expect(screen.getByRole('tab', { name: 'Xülasə' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA }));
    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'sites', period: 'last_7' }));
  });

  it('drills down from an employee row to their Summary', async () => {
    const router = renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=employees');
    await userEvent.click(await screen.findByRole('button', { name: 'Aynur Quliyeva' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'summary', userId: IDS.aynur }));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: TODAY, to: TODAY, userId: IDS.aynur }));
  });
});

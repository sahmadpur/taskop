import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPLOYEE_ROWS, meWith, page, reportProblems, reportSummary, VIEWER } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { HomePage } from './home-page';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { summary: vi.fn(), employees: vi.fn(), runs: vi.fn(), problems: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.reports.summary.mockResolvedValue(reportSummary());
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
  mocks.api.reports.runs.mockResolvedValue(page([]));
  mocks.api.reports.problems.mockResolvedValue(reportProblems([]));
  mocks.api.sites.list.mockResolvedValue([]);
  mocks.api.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
});

describe('HomePage', () => {
  it('keeps the welcome page for users without reports.view and asks for no report', async () => {
    mocks.me.current = meWith(['tasks.view']);
    renderWithRouter(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Xoş gəlmisiniz, Leyla!' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'İdarə paneli' })).not.toBeInTheDocument();
    expect(mocks.api.reports.summary).not.toHaveBeenCalled();
  });

  it('shows the dashboard to holders of reports.view', async () => {
    mocks.me.current = meWith(VIEWER);
    renderWithRouter(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'İdarə paneli' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledOnce());
    expect(screen.queryByRole('heading', { name: 'Xoş gəlmisiniz, Leyla!' })).not.toBeInTheDocument();
  });
});

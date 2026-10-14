import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { taskDetail } from '@/features/tasks/fixtures';
import { renderWithRouter } from '@/test/router';
import { IDS, meWith, reportProblem, reportProblems, TODAY, VIEWER } from './fixtures';
import { ProblemsTab } from './problems-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    reports: { problems: vi.fn() },
    occurrences: { get: vi.fn(), cancel: vi.fn() },
    executions: { get: vi.fn() },
    tasks: { get: vi.fn() },
    taskMedia: { url: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const FILTERS = { from: TODAY, to: TODAY };
const stat = (region: HTMLElement, label: string) => within(region).getByText(label).nextElementSibling;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'tasks.view']);
  mocks.api.reports.problems.mockResolvedValue(
    reportProblems([reportProblem(), reportProblem({ id: IDS.task2, severity: 'normal', source: 'rule', itemLabel: 'Qapı bağlıdır?', note: null, resolution: 'none', taskId: null, taskStatus: null })]),
  );
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('ProblemsTab', () => {
  it('shows the counts by severity and resolution and lists the problems with their task', async () => {
    renderWithRouter(<ProblemsTab filters={FILTERS} severity={null} onSeverity={vi.fn()} />);
    const counts = await screen.findByRole('region', { name: 'Problemlər' });
    expect(stat(counts, 'Cəmi problem')).toHaveTextContent('3');
    expect(stat(counts, 'Kritik')).toHaveTextContent('1');
    expect(stat(counts, 'Tapşırıq yoxdur')).toHaveTextContent('1');
    expect(stat(counts, 'Açıq')).toHaveTextContent('1');
    expect(stat(counts, 'Həll olunub')).toHaveTextContent('1');
    expect(stat(counts, 'Ləğv edilib')).toHaveTextContent('0');
    expect(mocks.api.reports.problems).toHaveBeenCalledWith(FILTERS);
    const rows = screen.getAllByRole('row');
    for (const text of ['Soyuducunun temperaturu', 'Açılış yoxlaması', 'Zona A1', 'Kritik', 'Əl ilə qeyd', 'Kondisioner xarabdır', 'Aynur Quliyeva', 'Açıq', 'İcradadır']) {
      expect(rows[1]).toHaveTextContent(text);
    }
    for (const text of ['Qapı bağlıdır?', 'Adi', 'Qayda üzrə', 'Tapşırıq yoxdur']) expect(rows[2]).toHaveTextContent(text);
    expect(within(rows[2]!).queryByRole('button', { name: /Tapşırığı aç/ })).not.toBeInTheDocument();
  });

  it('filters by severity with the chips', async () => {
    const onSeverity = vi.fn();
    renderWithRouter(<ProblemsTab filters={FILTERS} severity="critical" onSeverity={onSeverity} />);
    const chips = await screen.findByRole('group', { name: 'Ciddilik' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hamısı', 'Adi', 'Kritik']);
    expect(within(chips).getByRole('button', { name: 'Kritik' })).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.api.reports.problems).toHaveBeenCalledWith({ ...FILTERS, severity: 'critical' });
    await userEvent.click(within(chips).getByRole('button', { name: 'Hamısı' }));
    expect(onSeverity).toHaveBeenCalledWith(null);
    await userEvent.click(within(chips).getByRole('button', { name: 'Adi' }));
    expect(onSeverity).toHaveBeenLastCalledWith('normal');
  });

  it('opens a problem’s run on the execution tab and its task in the task drawer', async () => {
    renderWithRouter(<ProblemsTab filters={FILTERS} severity={null} onSeverity={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Soyuducunun temperaturu' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run2);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getAllByRole('row')[1]!).getByRole('button', { name: /Tapşırığı aç/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.tasks.get).toHaveBeenCalledWith(IDS.task);
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskDetail } from '@/features/tasks/fixtures';
import { renderWithRouter } from '@/test/router';
import { IDS, meWith, reportTask, reportTasks, TODAY, VIEWER } from './fixtures';
import { TasksTab } from './tasks-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { tasks: vi.fn() }, tasks: { get: vi.fn() }, taskMedia: { url: vi.fn() } },
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
  mocks.api.reports.tasks.mockResolvedValue(
    reportTasks([
      reportTask(),
      reportTask({ id: IDS.task2, title: 'Kameranı yoxla', priority: 'normal', status: 'accepted', assignee: null, team: { id: 'team1', name: 'Texniki xidmət' }, site: null, dueAt: null, overdue: false, problemId: null }),
    ]),
  );
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('TasksTab', () => {
  it('shows the status counts and on-time against late, and lists the tasks', async () => {
    renderWithRouter(<TasksTab filters={FILTERS} />);
    const counts = await screen.findByRole('region', { name: 'Tapşırıqlar' });
    expect(stat(counts, 'Yeni')).toHaveTextContent('1');
    expect(stat(counts, 'İcradadır')).toHaveTextContent('2');
    expect(stat(counts, 'Yoxlamada')).toHaveTextContent('1');
    expect(stat(counts, 'Tamamlanıb')).toHaveTextContent('3');
    expect(stat(counts, 'Gecikmiş (açıq)')).toHaveTextContent('1');
    expect(stat(counts, 'Vaxtında tamamlanıb')).toHaveTextContent('2');
    expect(stat(counts, 'Gecikmə ilə tamamlanıb')).toHaveTextContent('1');
    expect(mocks.api.reports.tasks).toHaveBeenCalledWith(FILTERS);
    const rows = screen.getAllByRole('row');
    for (const text of ['Kondisioneri təmir et', 'İcradadır', 'Gecikib', 'Yüksək', 'Kamran Əliyev', 'Zona A1', '18:00']) expect(rows[1]).toHaveTextContent(text);
    for (const text of ['Kameranı yoxla', 'Qəbul edilib', 'Adi', 'Texniki xidmət (komanda)']) expect(rows[2]).toHaveTextContent(text);
    expect(rows[2]).not.toHaveTextContent('Gecikib');
  });

  it('opens a task in the task drawer', async () => {
    renderWithRouter(<TasksTab filters={FILTERS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Kondisioneri təmir et' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.tasks.get).toHaveBeenCalledWith(IDS.task);
  });
});

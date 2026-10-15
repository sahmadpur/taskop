import type { ProblemDto } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { ProblemsPage } from './problems-page';
import { assigneeOptions, taskDetail } from '@/features/tasks/fixtures';

const mocks = vi.hoisted(() => ({
  canManageTasks: { current: true },
  api: {
    problems: { list: vi.fn() },
    sites: { list: vi.fn() },
    checklists: { list: vi.fn() },
    tasks: { create: vi.fn(), assignees: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: (...keys: string[]) => keys.every((k) => k !== 'tasks.manage' || mocks.canManageTasks.current),
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const problem = (over: Partial<ProblemDto> = {}): ProblemDto => ({
  id: 'p1', executionId: 'x1', occurrenceId: 'o1', localDate: '2026-11-02', siteId: 'site1', siteName: 'Anbar', checklistId: 'c1',
  checklistName: 'Açılış', itemId: 'i1', itemLabel: 'Temperatur', source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır',
  mediaIds: ['m1', 'm2'], media: [{ id: 'm1', kind: 'photo', status: 'uploaded' }, { id: 'm2', kind: 'video', status: 'pending' }],
  executorName: 'Aysel', createdAt: '2026-11-02T04:20:00.000Z', resolution: 'none', taskId: null, executionState: 'completed', clearedAt: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar' }]);
  mocks.api.checklists.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Açılış' }], nextCursor: null });
  mocks.api.problems.list.mockResolvedValue({
    items: [problem(), problem({ id: 'p2', itemId: 'i2', itemLabel: null, source: 'rule', severity: 'normal', note: null, mediaIds: [], media: [] })],
    nextCursor: null,
  });
  mocks.canManageTasks.current = true;
  mocks.api.tasks.assignees.mockResolvedValue(assigneeOptions());
});
afterEach(() => vi.useRealTimers());

describe('ProblemsPage', () => {
  it('hides problems a correction cleared unless asked, and marks them', async () => {
    mocks.api.problems.list.mockImplementation(async (q: { includeCleared?: string }) => ({
      items: q.includeCleared === 'true' ? [problem(), problem({ id: 'p2', itemId: 'i2', itemLabel: 'Qapı', clearedAt: '2026-11-03T08:00:00.000Z' })] : [problem()],
      nextCursor: null,
    }));
    renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByRole('link', { name: 'Temperatur' });
    expect(mocks.api.problems.list.mock.calls[0]![0]).not.toHaveProperty('includeCleared');
    expect(screen.queryByRole('link', { name: 'Qapı' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aradan qaldırılanları göstər' }));
    const cleared = (await screen.findByRole('link', { name: 'Qapı' })).closest('tr')!;
    expect(mocks.api.problems.list).toHaveBeenLastCalledWith(expect.objectContaining({ includeCleared: 'true' }));
    expect(cleared).toHaveAttribute('data-cleared', 'true');
    expect(within(cleared).getByText(az.corrections.cleared)).toBeInTheDocument();
    const active = screen.getByRole('link', { name: 'Temperatur' }).closest('tr')!;
    expect(active).not.toHaveAttribute('data-cleared');
    // Ruling F3: no task starts from a cleared problem.
    expect(within(cleared).queryByRole('button', { name: 'Tapşırıq yarat' })).not.toBeInTheDocument();
    expect(within(cleared).getByText(az.tasks.resolutions.none)).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Tapşırıq yarat' })).toBeEnabled();
  });

  it('lists problems with place, item, severity and source, and links a row to the occurrence drawer', async () => {
    const router = renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByText('Kondisioner xarabdır');
    expect(mocks.api.problems.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-29', to: '2026-11-04', limit: 50 }));
    const [, first, second] = screen.getAllByRole('row');
    for (const text of ['Anbar', 'Açılış', 'Temperatur', 'Kritik', 'Əl ilə qeyd', 'Aysel', '2 fayl']) expect(first).toHaveTextContent(text);
    for (const text of ['Silinmiş sual', 'Adi', 'Qayda üzrə']) expect(second).toHaveTextContent(text);
    await userEvent.click(within(first!).getByRole('link', { name: 'Temperatur' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
  });

  it('shows a loading line until the first page arrives', async () => {
    mocks.api.problems.list.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    expect(await screen.findByText('Yüklənir…')).toBeInTheDocument();
  });

  it('loads more pages and sends every filter', async () => {
    mocks.api.problems.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor ? { items: [problem({ id: 'p3', itemLabel: 'Qapı' })], nextCursor: null } : { items: [problem()], nextCursor: 'p1' },
    );
    renderWithRouter(<ProblemsPage today="2026-11-04" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    expect(await screen.findByRole('link', { name: 'Qapı' })).toBeInTheDocument();
    expect(mocks.api.problems.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'p1' }));
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'Anbar' });
    await screen.findByRole('option', { name: 'Açılış' });
    await userEvent.selectOptions(screen.getByLabelText('Ciddilik'), 'critical');
    await userEvent.selectOptions(screen.getByLabelText('Mənbə'), 'manual');
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), 'site1');
    await userEvent.selectOptions(screen.getByLabelText('Yoxlama vərəqəsi'), 'c1');
    await waitFor(() =>
      expect(mocks.api.problems.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 'critical', source: 'manual', siteId: 'site1', checklistId: 'c1', from: '2026-10-29', to: '2026-11-04' }),
      ),
    );
  });

  it('refuses a range over 92 days or an inverted one without asking the API', async () => {
    renderWithRouter(<ProblemsPage today="2026-11-04" />);
    await waitFor(() => expect(mocks.api.problems.list).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-08-03' } });
    expect(await screen.findByText('Tarix aralığı çox uzundur (ən çox 92 gün).')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-11-05' } });
    expect(await screen.findByText('Son tarix başlanğıc tarixindən əvvəl ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.problems.list).toHaveBeenCalledTimes(1);
  });

  it("defaults to the last 7 days of the tenant's calendar, not UTC's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 21:30 UTC on 2 November is 01:30 on 3 November in Baku: a problem from this morning's occurrence is dated 3 November.
    vi.setSystemTime(new Date('2026-11-02T21:30:00.000Z'));
    renderWithRouter(<ProblemsPage />);
    await waitFor(() => expect(mocks.api.problems.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-28', to: '2026-11-03' })));
    expect(screen.getByLabelText('Son tarix')).toHaveValue('2026-11-03');
  });
});

describe('ProblemsPage resolution', () => {
  it('shows the resolution, links a problem with a task to its drawer, and filters by resolution', async () => {
    mocks.api.problems.list.mockResolvedValue({
      items: [problem({ resolution: 'open', taskId: 't1' }), problem({ id: 'p2', resolution: 'resolved', taskId: 't2' })],
      nextCursor: null,
    });
    const router = renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByRole('link', { name: 'Açıq' });
    expect(screen.getByRole('columnheader', { name: 'Nəticə' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Həll olunub' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tapşırıq yarat' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Nəticə'), 'resolved');
    await waitFor(() => expect(mocks.api.problems.list).toHaveBeenLastCalledWith(expect.objectContaining({ resolution: 'resolved' })));
    await userEvent.click(await screen.findByRole('link', { name: 'Açıq' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(router.state.location.search).toEqual({ task: 't1' });
  });

  it("creates a task from a closed run's problem, pre-filled, and reloads the list", async () => {
    mocks.api.tasks.create.mockResolvedValue(taskDetail({ id: 'tnew', source: 'problem', problemId: 'p1' }));
    renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    const [create] = await screen.findAllByRole('button', { name: 'Tapşırıq yarat' });
    await userEvent.click(create!);
    const dialog = await screen.findByRole('dialog', { name: 'Problemdən tapşırıq' });
    expect(within(dialog).getByLabelText('Başlıq')).toHaveValue('Temperatur');
    expect(within(dialog).getByLabelText('Prioritet')).toHaveValue('high');
    expect(within(dialog).getByText('Obyekt problemdən götürülür: Anbar')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'İcraçı' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Nigar Səfərli' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({ problemId: 'p1', siteId: null, requiresReview: true }));
    await waitFor(() => expect(mocks.api.problems.list).toHaveBeenCalledTimes(2));
  });

  it('disables "Tapşırıq yarat" while the run is not closed (active or rejected), and offers it only to tasks.manage', async () => {
    const runOpenTitle = 'İcra hələ bağlanmayıb: tapşırıq yalnız bağlanmış icranın problemindən yaradıla bilər.';
    mocks.api.problems.list.mockResolvedValue({
      items: [
        problem({ executionState: 'active' }),
        problem({ id: 'p2', itemId: 'i2', itemLabel: 'Qapı', executionState: 'rejected' }),
        problem({ id: 'p3', itemId: 'i3', itemLabel: 'Pəncərə', executionState: 'partial' }),
      ],
      nextCursor: null,
    });
    renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByRole('link', { name: 'Temperatur' });
    const [, active, rejected, partial] = screen.getAllByRole('row');
    for (const row of [active!, rejected!]) {
      const create = within(row).getByRole('button', { name: 'Tapşırıq yarat' });
      expect(create).toBeDisabled();
      expect(within(row).getByTitle(runOpenTitle)).toContainElement(create);
    }
    expect(within(partial!).getByRole('button', { name: 'Tapşırıq yarat' })).toBeEnabled();
    cleanup();
    mocks.canManageTasks.current = false;
    mocks.api.problems.list.mockResolvedValue({ items: [problem()], nextCursor: null });
    renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByRole('link', { name: 'Temperatur' });
    const [, row] = screen.getAllByRole('row');
    expect(within(row!).getByText('Tapşırıq yoxdur')).toBeInTheDocument();
    expect(within(row!).queryByRole('button', { name: 'Tapşırıq yarat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tapşırıq yarat' })).not.toBeInTheDocument();
  });
});

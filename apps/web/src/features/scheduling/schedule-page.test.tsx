import { ApiError } from '@taskop/api-client';
import type { OccurrenceDto } from '@taskop/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { scheduleSearch } from './routes';
import { SchedulePage } from './schedule-page';

const mocks = vi.hoisted(() => ({ api: { occurrences: { list: vi.fn(), get: vi.fn(), cancel: vi.fn() }, sites: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const occ = (over: Partial<OccurrenceDto> = {}): OccurrenceDto => ({
  id: 'o1', assignmentId: 'a1', assignmentName: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
  shiftId: null, shiftName: null, localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z',
  closesAt: '2026-11-02T07:00:00.000Z', status: 'pending', statusChangedAt: '2026-11-02T04:00:00.000Z', cancelReason: null,
  assigneeIds: ['u1'], unassigned: false, executionBrief: null, ...over,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([]);
  mocks.api.occurrences.list.mockResolvedValue({
    items: [occ(), occ({ id: 'o2', localDate: '2026-11-03', startsAt: '2026-11-03T04:00:00.000Z', dueAt: '2026-11-03T06:00:00.000Z', status: 'overdue', assigneeIds: [], unassigned: true })],
    nextCursor: null,
  });
  mocks.api.occurrences.get.mockResolvedValue({
    ...occ(),
    assignees: [{ id: 'u1', fullName: 'Elvin' }],
    history: [{ fromStatus: null, toStatus: 'pending', at: '2026-11-02T04:00:00.000Z', actor: { kind: 'user', name: 'Leyla' }, reason: null }],
    execution: null, rejectedExecutions: [],
  });
  mocks.api.occurrences.cancel.mockResolvedValue({ ...occ({ status: 'cancelled' }), assignees: [], history: [], execution: null, rejectedExecutions: [] });
});

describe('SchedulePage', () => {
  it('groups the week by day and flags unassigned occurrences', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    await waitFor(() => expect(mocks.api.occurrences.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-02', to: '2026-11-08' })));
    const days = await screen.findAllByRole('region');
    expect(days).toHaveLength(2);
    // The status filter also has a "Gecikib" option, so look inside the day.
    expect(within(days[1]!).getByText('Gecikib')).toBeInTheDocument();
    expect(within(days[1]!).getByText('İcraçı yoxdur')).toBeInTheDocument();
  });

  it('opens an occurrence with its history and cancels it with a reason', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    const [first] = await screen.findAllByRole('button', { name: /Açılış/ });
    await userEvent.click(first!);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Elvin')).toBeInTheDocument();
    expect(within(dialog).getByText(/Leyla/)).toBeInTheDocument();
    const cancel = within(dialog).getByRole('button', { name: 'İcranı ləğv et' });
    expect(cancel).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Ləğv səbəbi'), 'Bayram');
    await userEvent.click(cancel);
    await waitFor(() => expect(mocks.api.occurrences.cancel).toHaveBeenCalledWith('o1', { reason: 'Bayram' }));
  });

  it('switches to the day view and moves between days', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Gün' }));
    await waitFor(() => expect(mocks.api.occurrences.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-04', to: '2026-11-04' })));
    await userEvent.click(screen.getByRole('button', { name: 'Növbəti' }));
    await waitFor(() => expect(mocks.api.occurrences.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-05', to: '2026-11-05' })));
  });

  it('shows an error instead of loading forever when an occurrence cannot be read', async () => {
    mocks.api.occurrences.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    const [first] = await screen.findAllByRole('button', { name: /Açılış/ });
    await userEvent.click(first!);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Məlumat tapılmadı.')).toBeInTheDocument();
  });

  it('shows the counted execution on a row: executor, progress, score and flags', async () => {
    const progress = { answered: 9, total: 10, requiredMissing: 0 };
    mocks.api.occurrences.list.mockResolvedValue({
      items: [
        occ({ status: 'completed', executionBrief: { executionId: 'x1', executorName: 'Aysel', state: 'completed', progress, scorePercent: 87.5, late: true, clockSuspect: true } }),
        occ({
          id: 'o2',
          status: 'partial',
          executionBrief: { executionId: 'x2', executorName: 'Murad', state: 'partial', progress: { answered: 2, total: 10, requiredMissing: 6 }, scorePercent: null, late: false, clockSuspect: false },
        }),
      ],
      nextCursor: null,
    });
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    const [day] = await screen.findAllByRole('region');
    const [done, partial] = within(day!).getAllByRole('button');
    for (const text of ['Tamamlanıb', 'Aysel', '9/10', '87,5%', 'Gecikib', 'Telefon saatı şübhəlidir']) expect(done).toHaveTextContent(text);
    for (const text of ['Murad', '2/10']) expect(partial).toHaveTextContent(text);
    expect(partial).not.toHaveTextContent('%');
    expect(within(partial!).getByText('Yarımçıq')).toHaveAttribute('data-variant', 'destructive');
  });

  it('opens the occurrence named in a link on its execution tab', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-02" initialOccurrenceId="o1" initialTab="execution" />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith('o1');
  });

  it('reads only valid link parameters', () => {
    expect(scheduleSearch({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' })).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
    expect(scheduleSearch({ date: '2.11.2026', occurrence: 5, tab: 'audit' })).toEqual({});
    expect(scheduleSearch({ date: '2026-13-45' })).toEqual({});
  });
});

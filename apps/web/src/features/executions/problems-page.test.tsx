import type { ProblemDto } from '@taskop/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { ProblemsPage } from './problems-page';

const mocks = vi.hoisted(() => ({ api: { problems: { list: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const problem = (over: Partial<ProblemDto> = {}): ProblemDto => ({
  id: 'p1', executionId: 'x1', occurrenceId: 'o1', localDate: '2026-11-02', siteId: 'site1', siteName: 'Anbar', checklistId: 'c1',
  checklistName: 'Açılış', itemId: 'i1', itemLabel: 'Temperatur', source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır',
  mediaIds: ['m1', 'm2'], executorName: 'Aysel', createdAt: '2026-11-02T04:20:00.000Z', ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar' }]);
  mocks.api.checklists.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Açılış' }], nextCursor: null });
  mocks.api.problems.list.mockResolvedValue({
    items: [problem(), problem({ id: 'p2', itemId: 'i2', itemLabel: null, source: 'rule', severity: 'normal', note: null, mediaIds: [] })],
    nextCursor: null,
  });
});
afterEach(() => vi.useRealTimers());

describe('ProblemsPage', () => {
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

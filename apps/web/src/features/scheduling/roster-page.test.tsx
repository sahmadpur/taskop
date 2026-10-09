import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { RosterPage } from './roster-page';

const mocks = vi.hoisted(() => ({
  api: { roster: { get: vi.fn(), put: vi.fn(), copy: vi.fn() }, sites: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const roster = {
  siteId: 'site1',
  from: '2026-11-02',
  to: '2026-11-08',
  users: [{ id: 'u1', fullName: 'Elvin' }],
  shifts: [
    {
      id: 's1',
      name: 'Səhər',
      startTime: '08:00',
      endTime: '16:00',
      siteId: null,
      siteName: null,
      active: true,
    },
  ],
  rows: [{ userId: 'u1', shiftId: 's1', date: '2026-11-02' }],
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([
    {
      id: 'site1',
      name: 'Anbar',
      parentId: null,
      typeId: 't',
      address: null,
      active: true,
      path: 'x',
      depth: 0,
    },
  ]);
  mocks.api.roster.get.mockResolvedValue(roster);
  mocks.api.roster.put.mockResolvedValue(roster);
  mocks.api.roster.copy.mockResolvedValue({ rowCount: 2 });
});

async function openSite() {
  renderWithProviders(<RosterPage initialDate="2026-11-04" />);
  await userEvent.selectOptions(await screen.findByLabelText('Obyekt'), 'site1');
  await waitFor(() =>
    expect(mocks.api.roster.get).toHaveBeenCalledWith({
      siteId: 'site1',
      from: '2026-11-02',
      to: '2026-11-08',
    }),
  );
}

describe('RosterPage', () => {
  it('shows the week from Monday and saves ticked cells', async () => {
    await openSite();
    expect(await screen.findByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-02' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-03' }));
    expect(screen.getByText('Saxlanmamış dəyişikliklər var')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.roster.put).toHaveBeenCalled());
    const body = mocks.api.roster.put.mock.calls[0]![0];
    expect(body).toMatchObject({ siteId: 'site1', from: '2026-11-02', to: '2026-11-08' });
    expect(body.rows).toEqual(
      expect.arrayContaining([
        { userId: 'u1', shiftId: 's1', date: '2026-11-02' },
        { userId: 'u1', shiftId: 's1', date: '2026-11-03' },
      ]),
    );
    expect(body.rows).toHaveLength(2);
  });

  it('disables copy while there are unsaved changes, then copies whole weeks', async () => {
    await openSite();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-03' }));
    expect(screen.getByRole('button', { name: 'Bu həftəni köçür…' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-03' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bu həftəni köçür…' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Neçə həftə irəli'), { target: { value: '2' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Köçür' }));
    await waitFor(() =>
      expect(mocks.api.roster.copy).toHaveBeenCalledWith({
        siteId: 'site1',
        sourceWeekStart: '2026-11-02',
        targetWeekStarts: ['2026-11-09', '2026-11-16'],
      }),
    );
  });

  it('moves between weeks', async () => {
    await openSite();
    await userEvent.click(screen.getByRole('button', { name: 'Növbəti həftə' }));
    await waitFor(() =>
      expect(mocks.api.roster.get).toHaveBeenLastCalledWith({
        siteId: 'site1',
        from: '2026-11-09',
        to: '2026-11-15',
      }),
    );
  });
});

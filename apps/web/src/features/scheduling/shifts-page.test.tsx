import type { ShiftDto } from '@taskop/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ShiftsPage } from './shifts-page';

const mocks = vi.hoisted(() => ({
  api: { shifts: { list: vi.fn(), create: vi.fn(), update: vi.fn() }, sites: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => true }));

const shift = (over: Partial<ShiftDto> = {}): ShiftDto => ({
  id: 's1', name: 'Səhər', startTime: '08:00', endTime: '16:00', siteId: null, siteName: null, active: true, ...over,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar', parentId: null, typeId: 't', address: null, active: true, path: 'x', depth: 0 }]);
});

describe('ShiftsPage', () => {
  it('lists shifts and marks the ones that end the next day', async () => {
    mocks.api.shifts.list.mockResolvedValue([shift(), shift({ id: 's2', name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: 'site1', siteName: 'Anbar' })]);
    renderWithProviders(<ShiftsPage />);
    expect(await screen.findByText('08:00–16:00')).toBeInTheDocument();
    expect(screen.getByText('22:00–06:00 (növbəti gün bitir)')).toBeInTheDocument();
    expect(screen.getByText('Bütün obyektlər')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Anbar' })).toBeInTheDocument();
  });

  it('creates a shift for one site', async () => {
    mocks.api.shifts.list.mockResolvedValue([]);
    mocks.api.shifts.create.mockResolvedValue(shift());
    renderWithProviders(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Növbə yarat' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'Gecə');
    fireEvent.change(within(dialog).getByLabelText('Başlama'), { target: { value: '22:00' } });
    fireEvent.change(within(dialog).getByLabelText('Bitmə'), { target: { value: '06:00' } });
    expect(within(dialog).getByText('növbəti gün bitir')).toBeInTheDocument();
    await within(dialog).findByRole('option', { name: 'Anbar' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Obyekt'), 'site1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.shifts.create).toHaveBeenCalledWith({ name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: 'site1' }));
  });

  it('rejects a zero-length shift before calling the API', async () => {
    mocks.api.shifts.list.mockResolvedValue([]);
    renderWithProviders(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Növbə yarat' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'X');
    fireEvent.change(within(dialog).getByLabelText('Bitmə'), { target: { value: '08:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }));
    expect(await within(dialog).findByText('Növbənin başlama və bitmə vaxtı eyni ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.shifts.create).not.toHaveBeenCalled();
  });

  it('deactivates a shift', async () => {
    mocks.api.shifts.list.mockResolvedValue([shift()]);
    mocks.api.shifts.update.mockResolvedValue(shift({ active: false }));
    renderWithProviders(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deaktiv et' }));
    await waitFor(() => expect(mocks.api.shifts.update).toHaveBeenCalledWith('s1', { active: false }));
  });
});

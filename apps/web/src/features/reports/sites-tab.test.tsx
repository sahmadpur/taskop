import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { IDS, SITE_ROWS, TODAY } from './fixtures';
import { SitesTab } from './sites-tab';

const mocks = vi.hoisted(() => ({ api: { reports: { sites: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const FILTERS = { from: TODAY, to: TODAY };
/** The name button of every data row, in order. */
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('button')[0]!.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.reports.sites.mockResolvedValue(SITE_ROWS);
});

describe('SitesTab', () => {
  it('compares sites in tree order with their parent path, inactive marks and percentages, and drills down', async () => {
    const onDrill = vi.fn();
    renderWithRouter(<SitesTab filters={FILTERS} onDrill={onDrill} />);
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.reports.sites).toHaveBeenCalledWith(FILTERS);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Obyekt',
      'Planlaşdırılıb',
      'Tamamlanıb',
      'Gecikib',
      'Yarımçıq',
      'Buraxılıb',
      'Problemli',
      'Tamamlanma faizi',
      'Orta bal',
    ]);
    expect(names()).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    const zone = within(rows[2]!).getAllByRole('cell');
    expect(zone[0]).toHaveTextContent('Filial A');
    expect(zone.slice(1).map((c) => c.textContent)).toEqual(['8', '5', '1', '0', '0', '0', '83,3%', '90%']);
    expect(rows[3]).toHaveTextContent('Deaktiv');
    expect(within(rows[3]!).getAllByRole('cell').slice(-2).map((c) => c.textContent)).toEqual(['—', '—']);
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Zona A1' }));
    expect(onDrill).toHaveBeenCalledWith(IDS.zoneA);
  });

  it('sorts by a column with missing percentages last, then reverses', async () => {
    renderWithRouter(<SitesTab filters={FILTERS} onDrill={vi.fn()} />);
    await screen.findAllByRole('row');
    const sort = screen.getByRole('button', { name: 'Tamamlanma faizi üzrə sırala' });
    await userEvent.click(sort);
    expect(names()).toEqual(['Zona A1', 'Filial A', 'Zona B (köhnə)']);
    expect(screen.getByRole('columnheader', { name: 'Tamamlanma faizi üzrə sırala' })).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(sort);
    expect(names()).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(screen.getByRole('columnheader', { name: 'Tamamlanma faizi üzrə sırala' })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: 'Obyekt üzrə sırala' }));
    expect(names()).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
  });

  it('says so when no site had a run in the period', async () => {
    mocks.api.reports.sites.mockResolvedValue([]);
    renderWithRouter(<SitesTab filters={FILTERS} onDrill={vi.fn()} />);
    expect(await screen.findByText('Bu dövr üçün məlumat yoxdur.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatLocalDate } from '@/features/scheduling/labels';
import { renderWithProviders } from '@/test/render';
import { fixedSizeCharts } from './chart-test-setup';
import { reportSummary, TODAY } from './fixtures';
import { TrendChart } from './trend-chart';

vi.mock('@/lib/session', () => ({ useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));
vi.mock('recharts', async (original) => fixedSizeCharts(await original<object>()));

describe('TrendChart', () => {
  it('draws due and completed per day with the completion line, and gives the same numbers as a table', () => {
    renderWithProviders(<TrendChart trend={reportSummary().trend} />);
    const figure = screen.getByRole('figure', { name: 'Gündəlik icra' });
    const rows = within(within(figure).getByRole('table', { name: 'Gündəlik icra cədvəli' })).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Tarix', 'Vaxtı çatıb', 'Tamamlanıb', 'Tamamlanma faizi']);
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([formatLocalDate('2026-11-02'), '4', '3', '75%']);
    // A day with nothing due is drawn as zero, its percentage as a dash.
    expect(within(rows[2]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([formatLocalDate('2026-11-03'), '0', '0', '—']);
    expect(within(rows[3]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([formatLocalDate(TODAY), '6', '4', '66,7%']);
  });

  it('draws nothing for a single day', () => {
    const { container } = renderWithProviders(<TrendChart trend={[{ date: TODAY, due: 2, completed: 1, completionPercent: 50 }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

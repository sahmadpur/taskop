import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { EmployeesTab } from './employees-tab';
import { EMPLOYEE_ROWS, IDS, TODAY } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { reports: { employees: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const FILTERS = { from: TODAY, to: TODAY };
const firstCells = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
});

describe('EmployeesTab', () => {
  it('lists people by name with the Unassigned row last and not clickable, the inactive mark and the over-count note', async () => {
    const onDrill = vi.fn();
    renderWithRouter(<EmployeesTab filters={FILTERS} onDrill={onDrill} />);
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.reports.employees).toHaveBeenCalledWith(FILTERS);
    expect(firstCells()).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf HəsənovDeaktiv', 'Təyin edilməyib']);
    expect(within(rows[4]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[4]!).getAllByRole('cell')[1]).toHaveTextContent('9');
    expect(
      screen.getByText(
        'Bir neçə icraçıya təyin olunmuş və icra edilməmiş icra hər icraçı üçün ayrıca sayılır, ona görə cəm obyektlər cədvəlindəkindən çox ola bilər.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Kamran Əliyev' }));
    expect(onDrill).toHaveBeenCalledWith(IDS.kamran);
  });

  it('keeps the Unassigned row last whatever the sort', async () => {
    renderWithRouter(<EmployeesTab filters={FILTERS} onDrill={vi.fn()} />);
    await screen.findAllByRole('row');
    // Unassigned has the most planned runs (9), yet stays at the bottom.
    await userEvent.click(screen.getByRole('button', { name: 'Planlaşdırılıb üzrə sırala' }));
    expect(firstCells()).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf HəsənovDeaktiv', 'Təyin edilməyib']);
    await userEvent.click(screen.getByRole('button', { name: 'Əməkdaş üzrə sırala' }));
    await userEvent.click(screen.getByRole('button', { name: 'Əməkdaş üzrə sırala' }));
    expect(firstCells()).toEqual(['Rauf HəsənovDeaktiv', 'Kamran Əliyev', 'Aynur Quliyeva', 'Təyin edilməyib']);
  });
});

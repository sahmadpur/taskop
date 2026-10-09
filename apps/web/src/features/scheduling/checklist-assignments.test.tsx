import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { ChecklistAssignments } from './checklist-assignments';

const mocks = vi.hoisted(() => ({ api: { assignments: { list: vi.fn() } }, can: true }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => mocks.can }));

const row = {
  id: 'a1', name: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
  schedule: { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] },
  timing: { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 },
  shiftName: null, status: 'active', revision: 1, assignees: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.can = true;
  mocks.api.assignments.list.mockResolvedValue({ items: [row], nextCursor: null });
});

describe('ChecklistAssignments', () => {
  it('lists the checklist’s assignments and links to assign it', async () => {
    renderWithRouter(<ChecklistAssignments checklistId="c1" canAssign />);
    expect(await screen.findByRole('link', { name: 'Səhər' })).toHaveAttribute('href', '/assignments/a1');
    expect(screen.getByRole('link', { name: 'Təyin et' })).toHaveAttribute('href', '/assignments/new?checklistId=c1');
    expect(mocks.api.assignments.list).toHaveBeenCalledWith(expect.objectContaining({ checklistId: 'c1' }));
  });

  it('hides the assign link for an unpublished or deactivated checklist', async () => {
    renderWithRouter(<ChecklistAssignments checklistId="c1" canAssign={false} />);
    await screen.findByRole('link', { name: 'Səhər' });
    expect(screen.queryByRole('link', { name: 'Təyin et' })).not.toBeInTheDocument();
  });

  it('renders nothing without assignments.view', async () => {
    mocks.can = false;
    renderWithRouter(<ChecklistAssignments checklistId="c1" canAssign />);
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(mocks.api.assignments.list).not.toHaveBeenCalled();
  });
});

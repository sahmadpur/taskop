import type { AssignmentDetail } from '@taskop/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { AssignmentDetailPage, AssignmentsPage, NewAssignmentPage } from './assignment-pages';

const mocks = vi.hoisted(() => ({
  api: {
    assignments: { list: vi.fn(), get: vi.fn(), pause: vi.fn(), resume: vi.fn(), end: vi.fn(), preview: vi.fn(), update: vi.fn(), create: vi.fn() },
    checklists: { list: vi.fn() },
    sites: { list: vi.fn() },
    users: { list: vi.fn() },
    shifts: { list: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const detail = (over: Partial<AssignmentDetail> = {}) =>
  ({
    id: 'a1', name: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
    schedule: { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] },
    timing: { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 },
    shiftName: null, status: 'active', revision: 1, assignees: [{ id: 'u1', fullName: 'Elvin' }],
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    upcoming: [
      { id: 'o1', assignmentId: 'a1', assignmentName: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar', shiftId: null, shiftName: null,
        localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z', status: 'pending',
        statusChangedAt: '2026-11-02T04:00:00.000Z', cancelReason: null, assigneeIds: ['u1'], unassigned: false },
    ],
    ...over,
  }) as AssignmentDetail;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.assignments.list.mockResolvedValue({ items: [detail()], nextCursor: null });
  mocks.api.assignments.get.mockResolvedValue(detail());
  mocks.api.assignments.preview.mockResolvedValue({ slots: [], warnings: [] });
  mocks.api.checklists.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Açılış', currentVersionNumber: 1 }], nextCursor: null });
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar', active: true }]);
  mocks.api.users.list.mockResolvedValue({ items: [{ id: 'u1', fullName: 'Elvin' }], nextCursor: null });
  mocks.api.shifts.list.mockResolvedValue([]);
});

describe('AssignmentsPage', () => {
  it('lists assignments with their summary and filters by search', async () => {
    renderWithRouter(<AssignmentsPage />);
    expect(await screen.findByRole('link', { name: 'Səhər' })).toHaveAttribute('href', '/assignments/a1');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Hər gün, 08:00–10:00')).toBeInTheDocument();
    expect(within(table).getByText('1 icraçı')).toBeInTheDocument();
    expect(within(table).getByText('Aktiv')).toBeInTheDocument();
    expect(mocks.api.assignments.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', limit: 200 }));
    await userEvent.type(screen.getByRole('searchbox'), 'səh');
    await waitFor(() => expect(mocks.api.assignments.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'səh' })));
  });
});

describe('AssignmentDetailPage', () => {
  it('shows upcoming occurrences and pauses, ends and copies the assignment', async () => {
    mocks.api.assignments.pause.mockResolvedValue(detail({ status: 'paused' }));
    mocks.api.assignments.end.mockResolvedValue(detail({ status: 'ended' }));
    const router = renderWithRouter(<AssignmentDetailPage assignmentId="a1" />, '/assignments/a1');
    expect(await screen.findByRole('heading', { name: 'Səhər' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Yaxın icralar' })).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dayandır' }));
    await waitFor(() => expect(mocks.api.assignments.pause).toHaveBeenCalledWith('a1'));
    await userEvent.click(screen.getByRole('button', { name: 'Bitir' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() => expect(mocks.api.assignments.end).toHaveBeenCalledWith('a1'));
    await userEvent.click(screen.getByRole('button', { name: 'Digər obyektlərə köçür' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/assignments/new'));
    expect(router.state.location.search).toMatchObject({ copyFrom: 'a1' });
  });
});

describe('NewAssignmentPage', () => {
  it('preselects the checklist from the link', async () => {
    renderWithRouter(<NewAssignmentPage checklistId="c1" />, '/assignments/new');
    await waitFor(() => expect(screen.getByLabelText('Yoxlama vərəqəsi')).toHaveValue('c1'));
  });
});

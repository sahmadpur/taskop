import { ApiError } from '@taskop/api-client';
import type { AssignmentDetail } from '@taskop/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AssignmentEditor } from './assignment-editor';

const mocks = vi.hoisted(() => ({
  api: {
    checklists: { list: vi.fn() },
    sites: { list: vi.fn() },
    users: { list: vi.fn() },
    shifts: { list: vi.fn() },
    assignments: { create: vi.fn(), update: vi.fn(), preview: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const SCHEDULE = { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] };
const TIMING = { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 };
const detail = (over: Partial<AssignmentDetail> = {}) =>
  ({
    id: 'a1', name: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar', schedule: SCHEDULE, timing: TIMING,
    shiftName: null, status: 'active', revision: 3, assignees: [{ id: 'u1', fullName: 'Elvin' }], createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z', upcoming: [], ...over,
  }) as AssignmentDetail;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.checklists.list.mockResolvedValue({
    items: [
      { id: 'c1', name: 'Açılış', currentVersionNumber: 1 },
      { id: 'c2', name: 'Qaralama', currentVersionNumber: null },
    ],
    nextCursor: null,
  });
  mocks.api.sites.list.mockResolvedValue([
    { id: 'site1', name: 'Anbar', active: true },
    { id: 'site2', name: 'Ofis', active: true },
  ]);
  mocks.api.users.list.mockResolvedValue({ items: [{ id: 'u1', fullName: 'Elvin' }], nextCursor: null });
  mocks.api.shifts.list.mockResolvedValue([]);
  mocks.api.assignments.preview.mockResolvedValue({
    slots: [{ localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z' }],
    warnings: [],
  });
});

async function fillBasics() {
  await screen.findByRole('option', { name: 'Açılış' });
  await userEvent.selectOptions(await screen.findByLabelText('Yoxlama vərəqəsi'), 'c1');
  await screen.findByRole('option', { name: 'Anbar' });
  await userEvent.selectOptions(await screen.findByLabelText('Obyekt'), 'site1');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Elvin' }));
}

describe('AssignmentEditor', () => {
  it('creates an assignment with a live preview', async () => {
    const onSaved = vi.fn();
    mocks.api.assignments.create.mockResolvedValue(detail());
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={onSaved} onCancel={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Açılış' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Qaralama' })).not.toBeInTheDocument();
    await fillBasics();
    expect(screen.getByText('Hər gün, 08:00–10:00')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.api.assignments.preview).toHaveBeenLastCalledWith({ siteId: 'site1', schedule: SCHEDULE, timing: TIMING, assigneeIds: ['u1'] }),
    );
    expect(await screen.findByText(/08:00–10:00$/, { selector: 'li' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() =>
      expect(mocks.api.assignments.create).toHaveBeenCalledWith({ name: null, checklistId: 'c1', siteId: 'site1', assigneeIds: ['u1'], schedule: SCHEDULE, timing: TIMING }),
    );
    expect(onSaved).toHaveBeenCalledWith(detail());
  });

  it('clears assignees when the site changes', async () => {
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await fillBasics();
    expect(screen.getByRole('button', { name: 'Yadda saxla' })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), 'site2');
    expect(await screen.findByRole('checkbox', { name: 'Elvin' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Yadda saxla' })).toBeDisabled();
  });

  it('names the users an error is about', async () => {
    mocks.api.assignments.create.mockRejectedValue(
      new ApiError(422, 'ASSIGNEE_NOT_AT_SITE', 'errors.ASSIGNEE_NOT_AT_SITE', null, null, 'r1', null, null, ['u1']),
    );
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('Seçilmiş icraçılardan biri bu obyektə aid deyil. (Elvin)')).toBeInTheDocument();
  });

  it('shows schedule issues and preview errors', async () => {
    mocks.api.assignments.preview.mockRejectedValue(new ApiError(422, 'WINDOW_TOO_LONG', 'errors.WINDOW_TOO_LONG'));
    mocks.api.assignments.create.mockRejectedValue(
      new ApiError(422, 'SCHEDULE_INVALID', 'errors.SCHEDULE_INVALID', null, null, 'r1', [{ path: ['schedule', 'endDate'], code: 'scheduling.issues.endBeforeStart' }]),
    );
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await fillBasics();
    expect(await screen.findByText('İcra müddəti 24 saatdan uzundur. Bunun üçün xüsusi icazə lazımdır.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('Bitmə tarixi başlama tarixindən əvvəl ola bilməz.')).toBeInTheDocument();
  });

  it('edits with the checklist and site locked, sending the revision', async () => {
    mocks.api.assignments.update.mockResolvedValue(detail({ revision: 4 }));
    renderWithProviders(<AssignmentEditor initial={detail()} today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByLabelText('Yoxlama vərəqəsi')).toBeDisabled();
    expect(screen.getByLabelText('Obyekt')).toBeDisabled();
    const name = screen.getByLabelText('Ad (istəyə bağlı)');
    await userEvent.clear(name);
    await userEvent.type(name, 'Axşam');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() =>
      expect(mocks.api.assignments.update).toHaveBeenCalledWith('a1', { revision: 3, name: 'Axşam', assigneeIds: ['u1'], schedule: SCHEDULE, timing: TIMING }),
    );
  });

  it('copies to another site without the old site and assignees', async () => {
    renderWithProviders(<AssignmentEditor preset={{ copyFrom: detail() }} today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Yoxlama vərəqəsi')).toHaveValue('c1'));
    expect(screen.getByLabelText('Obyekt')).toHaveValue('');
    expect(screen.getByLabelText('Ad (istəyə bağlı)')).toHaveValue('Səhər');
  });
});

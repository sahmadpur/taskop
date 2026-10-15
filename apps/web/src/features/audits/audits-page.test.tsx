import { az } from '@taskop/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKLISTS, IDS, meWith, page, SITES } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AuditsPage } from './audits-page';
import { apiError, AUDIT_IDS, AUDITOR, auditDto, queueRow } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { audits: { list: vi.fn(), start: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() }, users: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const AUDITOR_PERMS = ['audits.perform', 'sites.view', 'checklists.view', 'users.view'];
const inProgress = queueRow({ auditId: AUDIT_IDS.audit, auditState: 'in_progress', auditor: AUDITOR, startedAt: '2026-11-02T10:00:00.000Z' });
const finishedRow = queueRow({
  auditId: AUDIT_IDS.audit2,
  status: 'audited',
  auditState: 'failed',
  auditor: AUDITOR,
  result: 'failed',
  percent: 83.3,
  startedAt: '2026-11-02T10:00:00.000Z',
  finishedAt: '2026-11-02T11:00:00.000Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.current = meWith(AUDITOR_PERMS);
  mocks.api.audits.list.mockImplementation(async (q: { queue: string }) =>
    page(q.queue === 'waiting' ? [queueRow()] : q.queue === 'in_progress' ? [inProgress] : [finishedRow]),
  );
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
  mocks.api.users.list.mockResolvedValue({ items: [{ id: AUDIT_IDS.auditor, fullName: 'Rəşad Kazımov' }], nextCursor: null });
});

describe('AuditsPage', () => {
  it('opens on Waiting and lists the runs that wait for an audit', async () => {
    renderWithRouter(<AuditsPage />, '/audits');
    expect(await screen.findByRole('heading', { name: az.audits.title })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([az.audits.queues.waiting, az.audits.queues.in_progress, az.audits.queues.finished]);
    expect(screen.getByRole('tab', { name: az.audits.queues.waiting })).toHaveAttribute('aria-selected', 'true');
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.audits.list).toHaveBeenCalledWith({ queue: 'waiting' });
    expect(within(rows[0]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Tarix', 'Yoxlama vərəqəsi', 'Obyekt', 'İcraçı', 'Tamamlanıb', 'Əməliyyatlar']);
    for (const text of ['Açılış yoxlaması', 'Anbar №1', 'Nigar Səfərli', '09:00']) expect(rows[1]).toHaveTextContent(text);
    // A waiting run has no auditor and no result yet: those filters are not offered.
    expect(screen.queryByLabelText('Auditor')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nəticə')).not.toBeInTheDocument();
  });

  it('starts an audit from a waiting row and opens it', async () => {
    mocks.api.audits.start.mockResolvedValue(auditDto({ id: AUDIT_IDS.audit }));
    const router = renderWithRouter(<AuditsPage />, '/audits');
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: az.audits.actions.start }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/audits/${AUDIT_IDS.audit}`));
    expect(mocks.api.audits.start).toHaveBeenCalledWith(AUDIT_IDS.execution);
  });

  it('opens the existing audit when another auditor started it first', async () => {
    mocks.api.audits.start.mockRejectedValue(apiError(409, 'AUDIT_EXISTS', { auditId: AUDIT_IDS.audit2 }));
    const router = renderWithRouter(<AuditsPage />, '/audits');
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: az.audits.actions.start }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/audits/${AUDIT_IDS.audit2}`));
  });

  it('shows the auditor and the paused state in progress, and links a row to its audit', async () => {
    mocks.api.audits.list.mockResolvedValue(page([inProgress, queueRow({ ...inProgress, occurrenceId: IDS.run2, status: 'correction_required' })]));
    renderWithRouter(<AuditsPage />, '/audits?queue=in_progress');
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.audits.list).toHaveBeenCalledWith({ queue: 'in_progress' });
    for (const text of ['Rəşad Kazımov', '14:00', az.audits.statuses.in_progress]) expect(rows[1]).toHaveTextContent(text);
    expect(rows[2]).toHaveTextContent(az.scheduling.statuses.correction_required);
    expect(within(rows[1]!).getByRole('link', { name: 'Açılış yoxlaması' })).toHaveAttribute('href', `/audits/${AUDIT_IDS.audit}`);
  });

  it('switches to Finished and sends every filter it has', async () => {
    const router = renderWithRouter(<AuditsPage />, '/audits');
    await screen.findAllByRole('row');
    await userEvent.click(screen.getByRole('tab', { name: az.audits.queues.finished }));
    await waitFor(() => expect(router.state.location.search).toEqual({ queue: 'finished' }));
    const rows = await screen.findAllByRole('row');
    for (const text of ['Rəşad Kazımov', '15:00', az.audits.results.failed, '83,3%']) expect(rows[1]).toHaveTextContent(text);
    await screen.findByRole('option', { name: 'Rəşad Kazımov' });
    await userEvent.selectOptions(screen.getByLabelText('Nəticə'), 'failed');
    await userEvent.selectOptions(screen.getByLabelText('Auditor'), AUDIT_IDS.auditor);
    await screen.findByRole('option', { name: /Zona A1/ });
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), IDS.zoneA);
    await userEvent.selectOptions(screen.getByLabelText('Yoxlama vərəqəsi'), IDS.checklist);
    await waitFor(() =>
      expect(mocks.api.audits.list).toHaveBeenLastCalledWith({ queue: 'finished', result: 'failed', auditorId: AUDIT_IDS.auditor, siteId: IDS.zoneA, checklistId: IDS.checklist }),
    );
    expect(router.state.location.search).toEqual({ queue: 'finished', result: 'failed', auditorId: AUDIT_IDS.auditor, siteId: IDS.zoneA, checklistId: IDS.checklist });
  });

  it('asks for both dates, refuses an inverted range, and sends a valid one', async () => {
    renderWithRouter(<AuditsPage />, '/audits');
    await screen.findAllByRole('row');
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-10-31' } });
    expect(await screen.findByText('Başlanğıc və son tarixi birlikdə seçin.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Son tarix'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('Son tarix başlanğıc tarixindən əvvəl ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.audits.list).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Son tarix'), { target: { value: '2026-11-04' } });
    await waitFor(() => expect(mocks.api.audits.list).toHaveBeenLastCalledWith({ queue: 'waiting', from: '2026-10-31', to: '2026-11-04' }));
  });

  it('loads the next page with the cursor', async () => {
    mocks.api.audits.list.mockResolvedValueOnce(page([queueRow()], IDS.run)).mockResolvedValueOnce(page([queueRow({ occurrenceId: IDS.run2, executionId: IDS.execution })]));
    renderWithRouter(<AuditsPage />, '/audits');
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(mocks.api.audits.list).toHaveBeenLastCalledWith({ queue: 'waiting', cursor: IDS.run });
  });

  it('says so when a queue is empty, and hides pickers the user cannot fill', async () => {
    mocks.me.current = meWith(['audits.perform']);
    mocks.api.audits.list.mockResolvedValue(page([]));
    renderWithRouter(<AuditsPage />, '/audits');
    expect(await screen.findByText('Audit gözləyən icra yoxdur.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Obyekt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Yoxlama vərəqəsi')).not.toBeInTheDocument();
    expect(mocks.api.sites.list).not.toHaveBeenCalled();
  });
});

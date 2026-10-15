import type { ExecutionDetail, OccurrenceStatus } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/features/audits/fixtures';
import { ExecutionTab } from '@/features/executions/execution-tab';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { renderWithProviders } from '@/test/render';
import { reworkRequest } from './fixtures';

const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  api: { executions: { get: vi.fn() }, media: { url: vi.fn() }, corrections: { correct: vi.fn(), sendBack: vi.fn(), withdraw: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
  useCan: (...keys: string[]) => keys.every((k) => mocks.permissions.current.includes(k)),
}));

const SEND_BACK = az.corrections.actions.sendBack;
const renderTab = (status: OccurrenceStatus = 'completed', detail?: Partial<ExecutionDetail>) => {
  const f = executionFixture();
  mocks.api.executions.get.mockResolvedValue(f.detail(detail));
  renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status, execution: summary() })} />);
  return f;
};
const openDialog = async () => {
  await userEvent.click(await screen.findByRole('button', { name: SEND_BACK }));
  return screen.findByRole('dialog', { name: 'İcranı düzəlişə qaytar' });
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.permissions.current = ['executions.correct'];
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('Send back', () => {
  it('sends the flagged items back with a comment each and a due date on the tenant clock', async () => {
    mocks.api.corrections.sendBack.mockResolvedValue(reworkRequest());
    const f = renderTab();
    const dialog = await openDialog();
    // One checkbox per visible item: the follow-up "Təsvir edin" is visible, because "Problem varmı?" is "Bəli".
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(6);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Temperatur' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Temperatur — şərh' }), 'Termometrlə yenidən ölçün');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Qeyd' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Qeyd — şərh' }), 'Qeydi doldurun');
    expect(dialog).toHaveTextContent('2 bənd seçilib');
    fireEvent.change(within(dialog).getByLabelText(az.corrections.fields.dueAt), { target: { value: '2099-01-01T18:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(mocks.api.corrections.sendBack).toHaveBeenCalledWith('x1', {
      items: [
        { itemId: f.temp.id, comment: 'Termometrlə yenidən ölçün' },
        { itemId: f.note.id, comment: 'Qeydi doldurun' },
      ],
      dueAt: '2099-01-01T14:00:00.000Z',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.api.executions.get).toHaveBeenCalledTimes(2));
  });

  it('asks for at least one item, a comment on each, and a due date that has not passed', async () => {
    renderTab('audit_pending');
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(within(dialog).getByText('Ən azı bir bənd seçin.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Temperatur' }));
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(within(dialog).getByText('Hər seçilmiş bənd üçün şərh yazın.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Temperatur — şərh' }), 'Yenidən ölçün');
    fireEvent.change(within(dialog).getByLabelText(az.corrections.fields.dueAt), { target: { value: '2020-01-01T10:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(within(dialog).getByText(az.corrections.issues.dueInPast)).toBeInTheDocument();
    expect(mocks.api.corrections.sendBack).not.toHaveBeenCalled();
    // Unticking an item drops its comment box.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Temperatur' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Temperatur — şərh' })).not.toBeInTheDocument();
  });

  it('shows the server’s reason for a refused due date', async () => {
    mocks.api.corrections.sendBack.mockRejectedValue(apiError(400, 'VALIDATION_FAILED', { fields: { dueAt: 'corrections.issues.dueInPast' } }));
    renderTab();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Video' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Video — şərh' }), 'Daha yaxından çəkin');
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(await within(dialog).findByText(az.corrections.issues.dueInPast)).toBeInTheDocument();
  });

  it('shows the open request to every reader, and lets the manager withdraw it', async () => {
    const f = executionFixture();
    const rework = reworkRequest({ items: [{ itemId: f.temp.id, comment: 'Termometrlə yenidən ölçün' }], dueAt: '2026-11-03T14:00:00.000Z' });
    mocks.api.executions.get.mockResolvedValue(f.detail({ state: 'rework', reworkRound: 1, rework }));
    mocks.api.corrections.withdraw.mockResolvedValue({ ...rework, withdrawnAt: '2026-11-02T12:00:00.000Z' });
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'correction_required', execution: summary({ state: 'rework' }) })} />);
    const banner = await screen.findByText((_, el) => el?.getAttribute('data-slot') === 'alert' && el.textContent?.includes(az.corrections.reworkBanner) === true);
    expect(banner).toHaveTextContent('Leyla Quliyeva · ');
    expect(banner).toHaveTextContent('18:00');
    expect(banner).toHaveTextContent('Temperatur — Termometrlə yenidən ölçün');
    expect(screen.queryByRole('button', { name: SEND_BACK })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.corrections.actions.correct })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: az.corrections.actions.withdraw }));
    const confirm = await screen.findByRole('dialog', { name: 'Geri qaytarmanı ləğv et' });
    expect(confirm).toHaveTextContent('İcra əvvəlki statusuna qayıdacaq.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Təsdiqlə' }));
    expect(mocks.api.corrections.withdraw).toHaveBeenCalledWith('x1');
  });

  it('names Taskop support when a platform admin sent the run back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail({ state: 'rework', reworkRound: 1, rework: reworkRequest({ requestedBy: null, items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] }) }));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'correction_required', execution: summary({ state: 'rework' }) })} />);
    expect(await screen.findByText(/^Taskop dəstəyi · /)).toBeInTheDocument();
  });

  it('shows the banner without actions to someone who cannot correct', async () => {
    mocks.permissions.current = [];
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail({ state: 'rework', reworkRound: 1, rework: reworkRequest({ items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] }) }));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'correction_required', execution: summary({ state: 'rework' }) })} />);
    expect(await screen.findByText('Qeyd — Qeydi doldurun')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.corrections.actions.withdraw })).not.toBeInTheDocument();
  });
});

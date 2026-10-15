import type { ExecutionDetail, OccurrenceStatus } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/features/audits/fixtures';
import { ExecutionTab } from '@/features/executions/execution-tab';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  api: { executions: { get: vi.fn() }, media: { url: vi.fn() }, corrections: { correct: vi.fn(), sendBack: vi.fn(), withdraw: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
  useCan: (...keys: string[]) => keys.every((k) => mocks.permissions.current.includes(k)),
}));

const CORRECT = az.corrections.actions.correct;
const renderTab = (status: OccurrenceStatus = 'completed', detail?: Partial<ExecutionDetail>) => {
  const f = executionFixture();
  mocks.api.executions.get.mockResolvedValue(f.detail(detail));
  renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status, execution: summary() })} />);
  return f;
};
const editor = () => screen.getByRole('region', { name: CORRECT });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.permissions.current = ['executions.correct'];
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('Correct answers', () => {
  it('is offered to executions.correct holders on a completed or audit-pending run only', async () => {
    renderTab('audit_pending');
    expect(await screen.findByRole('button', { name: CORRECT })).toBeInTheDocument();
  });

  it.each([
    ['audited', 'completed'],
    ['partial', 'partial'],
    ['correction_required', 'rework'],
  ] as const)('is not offered on a %s run', async (status, state) => {
    renderTab(status, { state });
    await screen.findByRole('region', { name: 'Zal' });
    expect(screen.queryByRole('button', { name: CORRECT })).not.toBeInTheDocument();
  });

  it('is not offered without executions.correct', async () => {
    mocks.permissions.current = [];
    renderTab();
    await screen.findByRole('region', { name: 'Zal' });
    expect(screen.queryByRole('button', { name: CORRECT })).not.toBeInTheDocument();
  });

  it('saves the changed items with a reason and the revision it started from', async () => {
    mocks.api.corrections.correct.mockResolvedValue({ executionId: 'x1', answersRev: 5, changedItemIds: [], score: null });
    const f = renderTab();
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    const save = within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' });
    expect(save).toBeDisabled();
    expect(editor()).toHaveTextContent('Hələ heç nə dəyişdirilməyib.');
    const temp = within(editor()).getByRole('spinbutton', { name: 'Temperatur' });
    await userEvent.clear(temp);
    await userEvent.type(temp, '5');
    expect(within(editor()).getByRole('listitem', { name: 'Temperatur' })).toHaveAttribute('data-changed', 'true');
    expect(editor()).toHaveTextContent('1 bənd dəyişdirilib');
    await userEvent.click(save);
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    const confirm = within(dialog).getByRole('button', { name: 'Təsdiqlə' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Termometr səhv oxunub');
    await userEvent.click(confirm);
    expect(mocks.api.corrections.correct).toHaveBeenCalledWith('x1', {
      answersRev: 4,
      changes: [{ itemId: f.temp.id, answer: { number: 5, note: 'isti' } }],
      reason: 'Termometr səhv oxunub',
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: CORRECT })).not.toBeInTheDocument());
    // Refreshed at least once; the test client's staleTime of 0 also refetches when the answers list remounts.
    await waitFor(() => expect(mocks.api.executions.get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('checks the requirements before asking for a reason', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.clear(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }));
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editor()).toHaveTextContent('Bu düzəlişlə tələb olunan sahələr boş qalır.');
    expect(within(editor()).getByRole('listitem', { name: 'Təsvir edin' })).toHaveTextContent('Cavab tələb olunur');
    // A changed choice can reveal or hide a follow-up: "Xeyr" hides the description, so nothing is missing any more.
    await userEvent.click(within(editor()).getByRole('radio', { name: 'Xeyr' }));
    expect(within(editor()).queryByRole('listitem', { name: 'Təsvir edin' })).not.toBeInTheDocument();
    expect(editor()).not.toHaveTextContent('Bu düzəlişlə tələb olunan sahələr boş qalır.');
  });

  it('reloads the run and starts over when another manager corrected it first', async () => {
    const f = executionFixture();
    mocks.api.executions.get
      .mockResolvedValueOnce(f.detail())
      .mockResolvedValue(f.detail({ answersRev: 5, answers: { ...f.answers, [f.temp.id]: { number: 7, note: 'isti' } } }));
    mocks.api.corrections.correct.mockRejectedValue(apiError(409, 'ANSWERS_CONFLICT'));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'completed', execution: summary() })} />);
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    const temp = within(editor()).getByRole('spinbutton', { name: 'Temperatur' });
    await userEvent.clear(temp);
    await userEvent.type(temp, '5');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Termometr səhv oxunub');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('İcra bu vaxt başqa yerdə dəyişdirilib. Ən son cavablar yükləndi — düzəlişləri yenidən edin.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(within(editor()).getByRole('spinbutton', { name: 'Temperatur' })).toHaveValue(7));
    expect(editor()).toHaveTextContent('Hələ heç nə dəyişdirilməyib.');
  });

  it('shows what the server still misses', async () => {
    const f = renderTab();
    mocks.api.corrections.correct.mockRejectedValue(apiError(422, 'REQUIREMENTS_UNMET', { missing: [{ itemId: f.note.id, kind: 'answer' }] }));
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.type(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }), ', çox');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Təfərrüat');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(editor()).getByRole('listitem', { name: 'Qeyd' })).toHaveTextContent('Cavab tələb olunur');
  });

  it('keeps the reason dialog open with any other refusal', async () => {
    renderTab();
    mocks.api.corrections.correct.mockRejectedValue(apiError(409, 'EXECUTION_LOCKED'));
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.type(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }), '!');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Səbəb');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    expect(await within(dialog).findByText(az.errors.EXECUTION_LOCKED)).toBeInTheDocument();
  });

  it.each(['EXECUTION_LOCKED', 'EXECUTION_NOT_CORRECTABLE'] as const)('reloads the run views after %s', async (code) => {
    renderTab();
    mocks.api.corrections.correct.mockRejectedValue(apiError(409, code));
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.type(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }), '!');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Səbəb');
    const loads = mocks.api.executions.get.mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    expect(await within(dialog).findByText(az.errors[code])).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.executions.get.mock.calls.length).toBeGreaterThan(loads));
  });

  it('does not reload the run views after a refusal unrelated to its state', async () => {
    renderTab();
    mocks.api.corrections.correct.mockRejectedValue(apiError(422, 'VALIDATION_FAILED'));
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.type(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }), '!');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Səbəb');
    const loads = mocks.api.executions.get.mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    expect(await within(dialog).findByText(az.errors.VALIDATION_FAILED)).toBeInTheDocument();
    expect(mocks.api.executions.get.mock.calls.length).toBe(loads);
  });

  it('leaves the edit without saving', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.click(within(editor()).getByRole('button', { name: 'İmtina et' }));
    expect(screen.queryByRole('region', { name: CORRECT })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Temperatur' })).toHaveTextContent('10 °C');
    expect(mocks.api.corrections.correct).not.toHaveBeenCalled();
  });

  it('marks a corrected run beside its state', async () => {
    renderTab('completed', { corrected: true });
    expect(await screen.findByText(az.corrections.corrected)).toBeInTheDocument();
  });
});

import { ApiError } from '@taskop/api-client';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { renderWithProviders } from '@/test/render';
import { ComposeMessage } from './compose-message';
import { messageSummary, targetOptions } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { messages: { options: vi.fn(), preview: vi.fn(), send: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

async function fill({ title = '  Sabah iclas var ', body = ' Saat 10:00-da ofisdə. ' } = {}) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Texniki xidmət' }));
  await userEvent.type(screen.getByLabelText('Başlıq'), title);
  await userEvent.type(screen.getByLabelText('Mətn'), body);
}

const previewed = { title: 'Sabah iclas var', body: 'Saat 10:00-da ofisdə.', userIds: [], teamIds: ['team1'], siteIds: [], email: true };

beforeEach(() => {
  vi.resetAllMocks();
  // Radix's Checkbox inside a <form> measures its bubble input.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mocks.api.messages.options.mockResolvedValue(targetOptions());
});

describe('ComposeMessage', () => {
  it('previews, asks "N nəfərə göndəriləcək" and sends exactly what was previewed', async () => {
    mocks.api.messages.preview.mockResolvedValue({ recipientCount: 3 });
    mocks.api.messages.send.mockResolvedValue(messageSummary());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWithProviders(<ComposeMessage />, client);
    expect(screen.getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await fill();
    // '  Sabah iclas var ' is 18 characters as typed; the API gets it trimmed.
    expect(screen.getByText('18/80')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'E-poçt ilə də göndər' }));
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    await waitFor(() => expect(mocks.api.messages.preview).toHaveBeenCalledWith(previewed));
    const dialog = await screen.findByRole('dialog', { name: 'Mesajı göndər' });
    expect(dialog).toHaveTextContent('3 nəfərə göndəriləcək');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Göndər' }));
    await waitFor(() => expect(mocks.api.messages.send).toHaveBeenCalledWith(previewed));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Başlıq')).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Seçilmiş alıcılar' })).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notification-messages'] });
  });

  it('offers Göndər only for a recipient and non-blank text, and will not send to nobody or to more than 1000', async () => {
    renderWithProviders(<ComposeMessage />);
    await fill({ title: '   ', body: 'Mətn' });
    expect(screen.getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Başlıq'), 'İclas');
    mocks.api.messages.preview.mockResolvedValueOnce({ recipientCount: 0 }).mockResolvedValueOnce({ recipientCount: 1001 });
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    let dialog = await screen.findByRole('dialog', { name: 'Mesajı göndər' });
    expect(dialog).toHaveTextContent(i18n.t('notifications.issues.noRecipients', { count: 1000, max: 1000 }));
    expect(within(dialog).getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ləğv et' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    dialog = await screen.findByRole('dialog', { name: 'Mesajı göndər' });
    expect(dialog).toHaveTextContent(i18n.t('notifications.issues.tooManyRecipients', { count: 1000, max: 1000 }));
    expect(within(dialog).getByRole('button', { name: 'Göndər' })).toBeDisabled();
    expect(mocks.api.messages.send).not.toHaveBeenCalled();
  });

  it("shows the server's reasons: nobody left after expansion under the picker, a target out of scope as an error", async () => {
    mocks.api.messages.preview.mockResolvedValue({ recipientCount: 2 });
    mocks.api.messages.send
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { userIds: 'notifications.issues.noRecipients' }))
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN'));
    renderWithProviders(<ComposeMessage />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Göndər' }));
    expect(await screen.findByText(i18n.t('notifications.issues.noRecipients'))).toBeInTheDocument();
    // The draft stays for another try.
    expect(screen.getByLabelText('Başlıq')).toHaveValue('  Sabah iclas var ');
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Göndər' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu əməliyyat üçün icazəniz yoxdur.');
  });

  it('shows the general reason when the server names only fields this form does not show', async () => {
    mocks.api.messages.preview.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { 'userIds.3': 'notifications.issues.noRecipients' }),
    );
    renderWithProviders(<ComposeMessage />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.VALIDATION_FAILED'));
    expect(screen.queryByText(i18n.t('notifications.issues.noRecipients'))).not.toBeInTheDocument();
  });
});

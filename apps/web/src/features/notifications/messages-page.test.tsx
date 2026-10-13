import { ApiError } from '@taskop/api-client';
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { counts, messageDetail, messageSummary } from './fixtures';
import { MessageDetailDialog } from './message-history';
import { MessagesPage } from './messages-page';

const mocks = vi.hoisted(() => ({
  api: { messages: { list: vi.fn(), get: vi.fn(), options: vi.fn(), preview: vi.fn(), send: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const L = az.notifications.deliveryStatuses;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
});

describe('MessagesPage', () => {
  it('lists sent messages with sender, recipients, reads and per-channel counts, and loads more', async () => {
    mocks.api.messages.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor
        ? { items: [messageSummary({ id: 'm2', title: 'Köhnə mesaj', processed: false, recipientCount: 0, readCount: 0, push: counts() })], nextCursor: null }
        : { items: [messageSummary({ emailRequested: true, email: counts({ sent: 1 }) })], nextCursor: 'm1' },
    );
    renderWithRouter(<MessagesPage />, '/messages');
    expect(await screen.findByRole('heading', { name: 'Mesajlar' })).toBeInTheDocument();
    const row = (await screen.findByRole('link', { name: 'Sabah iclas var' })).closest('tr')!;
    expect(within(row).getAllByRole('cell').slice(1).map((c) => c.textContent)).toEqual([
      'Leyla Quliyeva',
      'Sabah iclas var',
      '3',
      '1',
      `${L.delivered}: 1 · ${L.failed}: 1`,
      `${L.sent}: 1`,
    ]);
    expect(mocks.api.messages.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    await userEvent.click(screen.getByRole('button', { name: 'Daha çox göstər' }));
    const second = (await screen.findByRole('link', { name: 'Köhnə mesaj' })).closest('tr')!;
    expect(within(second).getAllByRole('cell').slice(3).map((c) => c.textContent)).toEqual(['—', '—', 'Göndərilir…', 'Göndərilir…']);
    expect(mocks.api.messages.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'm1', limit: 50 }));
  });

  it('opens a message from the list: targets, totals, and each recipient with read state, channel status and error', async () => {
    mocks.api.messages.list.mockResolvedValue({ items: [messageSummary()], nextCursor: null });
    mocks.api.messages.get.mockResolvedValue(messageDetail());
    const router = renderWithRouter(<MessagesPage />, '/messages');
    await userEvent.click(await screen.findByRole('link', { name: 'Sabah iclas var' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ message: 'm1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sabah iclas var' });
    expect(mocks.api.messages.get).toHaveBeenCalledWith('m1');
    expect(dialog).toHaveTextContent('Saat 10:00-da ofisdə iclas olacaq.');
    expect(dialog).toHaveTextContent('Leyla Quliyeva');
    expect(dialog).toHaveTextContent('Əməkdaşlar: Nigar Səfərli');
    expect(dialog).toHaveTextContent('Komandalar: Texniki xidmət');
    expect(dialog).toHaveTextContent('Alıcılar: 3 · Oxunub: 1');
    expect(dialog).toHaveTextContent(`Push: ${L.delivered}: 1 · ${L.failed}: 1`);
    expect(dialog).toHaveTextContent('E-poçt: İstənilməyib');
    const recipient = (name: string) => within(dialog).getByRole('cell', { name }).closest('tr')!;
    expect(recipient('Murad Əliyev')).toHaveTextContent('Oxunmayıb');
    expect(recipient('Murad Əliyev')).toHaveTextContent(L.failed);
    expect(recipient('Murad Əliyev')).toHaveTextContent('DeviceNotRegistered');
    expect(recipient('Nigar Səfərli')).toHaveTextContent(L.delivered);
    expect(recipient('Nigar Səfərli')).toHaveTextContent('2 cihaz');
    expect(recipient('Nigar Səfərli')).not.toHaveTextContent('Oxunmayıb');
    expect(recipient('Aysel Məmmədova')).toHaveTextContent('Cihaz yoxdur');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('a link to a message the caller may not see shows the error in the dialog', async () => {
    mocks.api.messages.list.mockResolvedValue({ items: [], nextCursor: null });
    mocks.api.messages.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    renderWithRouter(<MessagesPage />, '/messages?message=m9');
    const dialog = await screen.findByRole('dialog', { name: 'Mesaj' });
    expect(await within(dialog).findByText('Məlumat tapılmadı.')).toBeInTheDocument();
    expect(screen.getByText('Hələ mesaj göndərilməyib.')).toBeInTheDocument();
  });

  it('a blank ?message= opens no dialog and asks for no message', async () => {
    mocks.api.messages.list.mockResolvedValue({ items: [], nextCursor: null });
    renderWithRouter(<MessagesPage />, '/messages?message=');
    expect(await screen.findByText('Hələ mesaj göndərilməyib.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.api.messages.get).not.toHaveBeenCalled();
  });

  it('the detail dialog never requests a blank message id', async () => {
    renderWithRouter(<MessageDetailDialog id="" onClose={() => {}} />, '/messages');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.messages.get).not.toHaveBeenCalled();
  });
});

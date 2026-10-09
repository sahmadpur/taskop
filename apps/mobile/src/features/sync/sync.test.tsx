import { act, fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { SyncIndicator } from './sync-indicator';
import { SyncScreen } from './sync-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

beforeEach(() => mockPush.mockClear());

describe('sync indicator', () => {
  it('is green when everything is synced and opens the queue', async () => {
    const t = await createTestServices({ online: true });
    await t.seed();
    await renderWithServices(t.services, <SyncIndicator />);
    expect(screen.getByTestId('sync-indicator-synced')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sinxronlaşdırılıb' }));
    expect(mockPush).toHaveBeenCalledWith('/sync');
  });

  it('is amber "Oflayn" with nothing waiting, then amber with the number of waiting changes', async () => {
    const t = await createTestServices();
    await t.seed();
    await renderWithServices(t.services, <SyncIndicator />);
    expect(await screen.findByText('Oflayn')).toBeTruthy();
    await act(async () => {
      const id = await t.services.store.start(OCC, ME);
      await t.services.store.patchAnswer(id, t.c.temp.id, { number: 5 });
    });
    expect(await screen.findByText('2 gözləyir')).toBeTruthy();
    expect(screen.getByTestId('sync-indicator-pending')).toBeTruthy();
  });

  it('is red when a command was refused', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    await t.db.run(`UPDATE outbox SET status = 'failed', error_code = 'CLOCK_INVALID', error_key = 'errors.CLOCK_INVALID'`);
    await t.services.engine.refresh();
    await renderWithServices(t.services, <SyncIndicator />);
    expect(screen.getByText('1 xəta')).toBeTruthy();
    expect(screen.getByTestId('sync-indicator-failed')).toBeTruthy();
  });
});

describe('sync screen', () => {
  it('lists waiting and failed work with the reason, warns about the clock, and retries', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    await t.services.store.patchAnswer(id, t.c.temp.id, { number: 5 });
    await t.db.run(`UPDATE outbox SET status = 'failed', error_code = 'CLOCK_INVALID', error_key = 'errors.CLOCK_INVALID' WHERE kind = 'claim'`);
    await t.db.run(`UPDATE meta SET value = '-420000' WHERE key = 'clockOffsetMs'`);
    await t.services.engine.refresh();
    await renderWithServices(t.services, <SyncScreen />);
    expect(await screen.findByText('Başlama · Açılış yoxlaması')).toBeTruthy();
    expect(screen.getByText('Telefonun saatını yoxlayın.')).toBeTruthy();
    expect(screen.getByText('Cavablar · Açılış yoxlaması')).toBeTruthy();
    expect(screen.getByText('Gözləyir')).toBeTruthy();
    expect(screen.getByText('Telefonun saatı serverdən 7 dəqiqə fərqlənir. Telefonun saatını yoxlayın.')).toBeTruthy();
    t.net.online = true;
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    await eventually(async () => expect(t.api.calls.map((c) => c.method)).toEqual(['claim', 'saveAnswers', 'pull']));
    expect(await screen.findByText('Göndəriləcək heç nə yoxdur.')).toBeTruthy();
  });
});

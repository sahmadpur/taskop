import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, OCC, T } from '@/offline/testing/fixtures';
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

  it('"Sil" removes a failed command after a confirmation; waiting rows have no "Sil"', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    await t.services.store.patchAnswer(id, t.c.temp.id, { number: 5 });
    await t.db.run(`UPDATE outbox SET status = 'failed', error_code = 'CLOCK_INVALID', error_key = 'errors.CLOCK_INVALID' WHERE kind = 'claim'`);
    await t.services.engine.refresh();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <SyncScreen />);
    expect(await screen.findByText('Başlama · Açılış yoxlaması')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sil: Cavablar · Açılış yoxlaması' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sil: Başlama · Açılış yoxlaması' }));
    expect(alert.mock.calls[0]![0]).toBe('Silinsin?');
    expect(alert.mock.calls[0]![1]).toBe('Başlama silinsə, bu icranın göndərilməmiş cavabları və faylları da silinəcək. Bu, geri qaytarıla bilməz.');
    const buttons = alert.mock.calls[0]![2] as AlertButton[];
    expect(await t.services.store.unsyncedCount()).toBe(2);
    await act(async () => buttons.find((b) => b.text === 'Sil')!.onPress?.());
    expect(await screen.findByText('Göndəriləcək heç nə yoxdur.')).toBeTruthy();
    expect(await t.services.store.unsyncedCount()).toBe(0);
    expect(t.services.engine.status().failed).toBe(0);
    alert.mockRestore();
  });

  it('"Sil" on a file that failed to upload removes it after a confirmation', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    await t.services.store.attachMedia(id, capturedPhoto(t.transport), { itemId: t.c.photo.id, field: 'evidence' });
    await t.db.run(`DELETE FROM outbox`);
    await t.db.run(`UPDATE media SET registered_at = ?, failed_code = 'UPLOAD_FAILED', attempts = 5`, [T.open]);
    await t.services.engine.refresh();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <SyncScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sil: Fayl yükləmə · Açılış yoxlaması' }));
    expect(alert.mock.calls[0]![1]).toBe('Bu dəyişiklik serverə göndərilməyəcək və telefondan silinəcək. Bu, geri qaytarıla bilməz.');
    await act(async () => (alert.mock.calls[0]![2] as AlertButton[]).find((b) => b.text === 'Ləğv et')!.onPress?.());
    expect(t.services.engine.status().failed).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Sil: Fayl yükləmə · Açılış yoxlaması' }));
    await act(async () => (alert.mock.calls[1]![2] as AlertButton[]).find((b) => b.text === 'Sil')!.onPress?.());
    await eventually(async () => expect(t.services.engine.status().failed).toBe(0));
    expect(await t.services.store.mediaRefusals(id)).toHaveLength(1);
    alert.mockRestore();
  });
});

import { fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import '@/lib/i18n';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ProfileScreen } from './profile-screen';

const mockSignOut = jest.fn(async () => undefined);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/session', () => ({
  session: { signOut: () => mockSignOut() },
  useSession: () => ({
    status: 'authenticated',
    offline: false,
    me: {
      user: { fullName: 'Aysel Əliyeva', jobTitle: null, username: 'aysel', email: null },
      role: { name: 'Worker', systemKey: 'worker' },
      tenant: { name: 'Acme' },
    },
  }),
}));

const press = (buttons: AlertButton[] | undefined, text: string) => buttons!.find((b) => b.text === text)!.onPress?.();

beforeEach(() => mockSignOut.mockClear());

describe('logout', () => {
  it('warns twice before deleting unsynced data', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    const [title, body, buttons] = alert.mock.calls[0]!;
    expect([title, body]).toEqual(['Göndərilməmiş məlumat var', '1 dəyişiklik hələ serverə göndərilməyib. Çıxsanız, onlar bu telefondan silinəcək.']);
    press(buttons, 'Yenə də çıx');
    expect(alert.mock.calls[1]![0]).toBe('Əminsiniz?');
    expect(mockSignOut).not.toHaveBeenCalled();
    press(alert.mock.calls[1]![2], 'Sil və çıx');
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(await t.services.store.occurrences()).toEqual([]);
    expect(await t.services.store.unsyncedCount()).toBe(0);
    alert.mockRestore();
  });

  it('keeps everything when the worker cancels', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    press(alert.mock.calls[0]![2], 'Ləğv et');
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(await t.services.store.unsyncedCount()).toBe(1);
    alert.mockRestore();
  });

  it('clears local data and signs out at once when everything is synced', async () => {
    const t = await createTestServices();
    await t.seed();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(await t.services.store.occurrences()).toEqual([]);
    alert.mockRestore();
  });
});

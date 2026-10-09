import { act, fireEvent, screen } from '@testing-library/react-native';
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

const press = (buttons: AlertButton[] | undefined, text: string) => act(async () => buttons!.find((b) => b.text === text)!.onPress?.());

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
    await press(buttons, 'Yenə də çıx');
    expect(alert.mock.calls[1]![0]).toBe('Əminsiniz?');
    expect(mockSignOut).not.toHaveBeenCalled();
    await press(alert.mock.calls[1]![2], 'Sil və çıx');
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
    await press(alert.mock.calls[0]![2], 'Ləğv et');
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

  it('still signs out when clearing local data fails', async () => {
    const t = await createTestServices();
    await t.seed();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(t.services, 'clearAll').mockRejectedValue(new Error('disk'));
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('shows the warning when unsynced data cannot be counted', async () => {
    const t = await createTestServices();
    await t.seed();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(t.services.store, 'unsyncedCount').mockRejectedValue(new Error('db'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]![0]).toBe('Əminsiniz?');
    expect(mockSignOut).not.toHaveBeenCalled();
    alert.mockRestore();
    error.mockRestore();
  });

  it('ignores a second tap while logout is running and re-enables after cancel', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Çıxış' }).props.accessibilityState.disabled).toBe(true);
    await press(alert.mock.calls[0]![2], 'Ləğv et');
    await eventually(async () => expect(screen.getByRole('button', { name: 'Çıxış' }).props.accessibilityState.disabled).toBe(false));
    alert.mockRestore();
  });

  it('re-enables the button and shows an error when sign-out fails', async () => {
    const t = await createTestServices();
    await t.seed();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSignOut.mockRejectedValueOnce(new Error('keychain'));
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    await eventually(async () => expect(screen.getByRole('button', { name: 'Çıxış' }).props.accessibilityState.disabled).toBe(false));
    expect(error).toHaveBeenCalled();
    alert.mockRestore();
    error.mockRestore();
  });
});

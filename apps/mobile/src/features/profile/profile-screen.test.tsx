import { ApiError } from '@taskop/api-client';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton, AppState } from 'react-native';
import '@/lib/i18n';
import type { FakePush, FakeTokens } from '@/notifications/testing/fakes';
import { PUSH_TOKEN } from '@/notifications/testing/fakes';
import { OfflineServicesProvider } from '@/offline/context';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ProfileScreen } from './profile-screen';

const mockSignOut = jest.fn();
const mockForceSignedOut = jest.fn();
const mockRemove = jest.fn();
const mockUpdate = jest.fn();
const mockPatchUser = jest.fn();
const mockEvents: string[] = [];
let mockUser = { fullName: 'Aysel Əliyeva', jobTitle: null as string | null, username: 'aysel', email: null as string | null, emailNotifications: true };
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/session', () => ({
  api: {
    pushDevices: { remove: (...a: unknown[]) => mockRemove(...a) },
    preferences: { update: (...a: unknown[]) => mockUpdate(...a) },
  },
  session: { signOut: () => mockSignOut(), forceSignedOut: () => mockForceSignedOut(), patchUser: (...a: unknown[]) => mockPatchUser(...a) },
  useSession: () => ({
    status: 'authenticated',
    offline: false,
    me: { user: mockUser, role: { name: 'Worker', systemKey: 'worker' }, tenant: { name: 'Acme' }, permissions: [] },
  }),
}));
jest.mock('@/notifications/native', () => {
  const { fakePush, fakeTokens } = jest.requireActual<typeof import('@/notifications/testing/fakes')>('@/notifications/testing/fakes');
  return { nativePush: fakePush(), pushTokenStore: fakeTokens(), openSettings: jest.fn(async () => undefined) };
});
const native = jest.requireMock<{ nativePush: FakePush; pushTokenStore: FakeTokens; openSettings: jest.Mock }>('@/notifications/native');

const press = (buttons: AlertButton[] | undefined, text: string) => act(async () => buttons!.find((b) => b.text === text)!.onPress?.());
const emailSwitch = () => screen.getByRole('switch', { name: 'E-poçt bildirişləri' });

beforeEach(() => {
  mockEvents.length = 0;
  mockSignOut.mockReset();
  mockSignOut.mockImplementation(async () => void mockEvents.push('signOut'));
  mockForceSignedOut.mockReset();
  mockRemove.mockReset();
  mockRemove.mockImplementation(async () => void mockEvents.push('remove'));
  mockUpdate.mockReset();
  mockPatchUser.mockReset();
  mockPatchUser.mockImplementation(async (patch: Partial<typeof mockUser>) => {
    mockUser = { ...mockUser, ...patch };
  });
  mockUser = { fullName: 'Aysel Əliyeva', jobTitle: null, username: 'aysel', email: null, emailNotifications: true };
  native.pushTokenStore.value = null;
  native.nativePush.setBadge.mockReset();
  native.nativePush.setBadge.mockImplementation(async (n: number) => void mockEvents.push(`badge:${n}`));
  native.nativePush.isDevice = true;
  native.nativePush.permission.mockReset();
  native.nativePush.permission.mockResolvedValue('granted');
  native.openSettings.mockClear();
});

describe('logout', () => {
  it("removes this phone's push device before signing out, and clears the badge", async () => {
    const t = await createTestServices();
    await t.seed();
    native.pushTokenStore.value = PUSH_TOKEN;
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(mockRemove).toHaveBeenCalledWith(PUSH_TOKEN);
    expect(mockEvents).toEqual(['remove', 'badge:0', 'signOut']);
    expect(native.pushTokenStore.value).toBeNull();
  });

  it('clears the badge only after the local data is cleared, so a sync finishing meanwhile cannot bring it back', async () => {
    const t = await createTestServices();
    await t.seed();
    const clearAll = t.services.clearAll.bind(t.services);
    jest.spyOn(t.services, 'clearAll').mockImplementation(async () => {
      mockEvents.push('clearAll:start');
      await clearAll();
      // A badge update from a sync that was still finishing, landing as the data is cleared.
      await native.nativePush.setBadge(5);
      mockEvents.push('clearAll:end');
    });
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(mockEvents).toEqual(['clearAll:start', 'badge:5', 'clearAll:end', 'badge:0', 'signOut']);
    expect(native.nativePush.setBadge).toHaveBeenLastCalledWith(0);
  });

  it('still clears the badge and signs out when clearing the local data fails', async () => {
    const t = await createTestServices();
    await t.seed();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(t.services, 'clearAll').mockRejectedValueOnce(new Error('disk'));
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(native.nativePush.setBadge).toHaveBeenCalledWith(0);
    error.mockRestore();
  });

  it('still signs out when removing the push device fails', async () => {
    const t = await createTestServices();
    await t.seed();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    native.pushTokenStore.value = PUSH_TOKEN;
    mockRemove.mockRejectedValueOnce(new Error('offline'));
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(await t.services.store.occurrences()).toEqual([]);
    warn.mockRestore();
  });

  it('removes the device only after the worker confirmed deleting unsynced data', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    native.pushTokenStore.value = PUSH_TOKEN;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    await press(alert.mock.calls[0]![2], 'Ləğv et');
    expect(mockRemove).not.toHaveBeenCalled();
    expect(native.nativePush.setBadge).not.toHaveBeenCalled();
    alert.mockRestore();
  });

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
    // The local data is already gone and the services stopped: staying signed in would lose later work.
    expect(mockForceSignedOut).toHaveBeenCalledTimes(1);
    alert.mockRestore();
    error.mockRestore();
  });

  it('does not force a sign-out when neither clearing nor signing out worked', async () => {
    const t = await createTestServices();
    await t.seed();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(t.services, 'clearAll').mockRejectedValue(new Error('disk'));
    mockSignOut.mockRejectedValueOnce(new Error('keychain'));
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    expect(mockForceSignedOut).not.toHaveBeenCalled();
    alert.mockRestore();
    error.mockRestore();
  });
});

describe('notification settings', () => {
  it('keeps what the server answered, even when it differs from what was sent', async () => {
    mockUser = { ...mockUser, emailNotifications: false };
    mockUpdate.mockResolvedValue({ emailNotifications: false });
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <ProfileScreen />);
    expect(emailSwitch().props.value).toBe(false);
    expect(screen.getByText('Hesabınızda e-poçt ünvanı yoxdur, ona görə e-poçt göndərilmir.')).toBeTruthy();
    await fireEvent(emailSwitch(), 'valueChange', true);
    await eventually(async () => expect(mockPatchUser).toHaveBeenCalledWith({ emailNotifications: false }));
    expect(mockUpdate).toHaveBeenCalledWith({ emailNotifications: true });
    await eventually(async () => expect(emailSwitch().props.disabled).toBe(false));
    expect(emailSwitch().props.value).toBe(false);
  });

  it('follows the session profile when it changes underneath the screen', async () => {
    const t = await createTestServices({ online: true });
    const view = await renderWithServices(t.services, <ProfileScreen />);
    expect(emailSwitch().props.value).toBe(true);
    mockUser = { ...mockUser, emailNotifications: false };
    await view.rerender(
      <OfflineServicesProvider services={t.services}>
        <ProfileScreen />
      </OfflineServicesProvider>,
    );
    expect(emailSwitch().props.value).toBe(false);
  });

  it('disables the switch while saving and ignores a second change until it settles', async () => {
    let resolve!: (v: { emailNotifications: boolean }) => void;
    mockUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent(emailSwitch(), 'valueChange', false);
    await eventually(async () => expect(emailSwitch().props.disabled).toBe(true));
    expect(emailSwitch().props.value).toBe(false);
    await fireEvent(emailSwitch(), 'valueChange', true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ emailNotifications: false }));
    await eventually(async () => expect(emailSwitch().props.disabled).toBe(false));
    expect(emailSwitch().props.value).toBe(false);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('puts the switch back and shows the error when saving fails', async () => {
    mockUser = { ...mockUser, email: 'aysel@demo.taskop.az' };
    mockUpdate.mockRejectedValue(new ApiError(500, 'INTERNAL', 'errors.INTERNAL'));
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <ProfileScreen />);
    expect(screen.queryByText('Hesabınızda e-poçt ünvanı yoxdur, ona görə e-poçt göndərilmir.')).toBeNull();
    await fireEvent(emailSwitch(), 'valueChange', false);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(emailSwitch().props.value).toBe(true);
    expect(mockPatchUser).not.toHaveBeenCalled();
  });

  it('offline the switch is disabled and says a connection is needed', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <ProfileScreen />);
    expect(await screen.findByText('Dəyişmək üçün internet bağlantısı tələb olunur.')).toBeTruthy();
    expect(emailSwitch().props.disabled).toBe(true);
  });

  it('shows the push permission, opens the settings when it is denied, and reads it again on return', async () => {
    native.nativePush.permission.mockResolvedValue('denied');
    const t = await createTestServices();
    await renderWithServices(t.services, <ProfileScreen />);
    expect(await screen.findByText('Bağlıdır')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ayarları aç' }));
    expect(native.openSettings).toHaveBeenCalledTimes(1);
    native.nativePush.permission.mockResolvedValue('granted');
    const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)![1] as (state: string) => void;
    await act(async () => onChange('active'));
    expect(await screen.findByText('Açıqdır')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ayarları aç' })).toBeNull();
  });

  it('says push is not available on a simulator', async () => {
    native.nativePush.isDevice = false;
    const t = await createTestServices();
    await renderWithServices(t.services, <ProfileScreen />);
    expect(await screen.findByText('Bu cihazda dəstəklənmir')).toBeTruthy();
    expect(native.nativePush.permission).not.toHaveBeenCalled();
  });
});

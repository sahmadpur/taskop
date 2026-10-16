import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANGUAGE_STORAGE_KEY } from '@taskop/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import i18n from '@/lib/i18n';
import { LanguagePicker } from './language-picker';

const mockUpdate = jest.fn();
const mockPatchUser = jest.fn();
const mockState = { current: { status: 'anonymous' } as { status: string; me?: unknown } };
jest.mock('@/lib/session', () => ({
  api: { preferences: { update: (...a: unknown[]) => mockUpdate(...a) } },
  session: { get: () => mockState.current, patchUser: (...a: unknown[]) => mockPatchUser(...a) },
}));

beforeEach(() => {
  mockUpdate.mockReset();
  mockPatchUser.mockReset();
  mockState.current = { status: 'anonymous' };
});
afterEach(async () => {
  await i18n.changeLanguage('az');
  await AsyncStorage.clear();
});

describe('LanguagePicker', () => {
  it('lists the three languages in their own names with Azerbaijani selected', async () => {
    await render(<LanguagePicker />);
    expect(screen.getByRole('radio', { name: 'Azərbaycan dili' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeTruthy();
  });

  it('switches the UI language and stores the choice on the phone', async () => {
    await render(<LanguagePicker />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState.selected).toBe(true);
    expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('LanguagePicker while signed in', () => {
  it('saves the choice to the profile and applies the saved value to the session', async () => {
    mockState.current = { status: 'authenticated', me: { user: { id: 'u1', locale: null } } };
    mockUpdate.mockResolvedValue({ emailNotifications: true, locale: 'ru' });
    await render(<LanguagePicker />);
    fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ locale: 'ru' }));
    await waitFor(() => expect(mockPatchUser).toHaveBeenCalledWith({ locale: 'ru' }, 'u1'));
    expect(i18n.language).toBe('ru');
  });

  it('keeps the local choice when the profile cannot be saved', async () => {
    mockState.current = { status: 'authenticated', me: { user: { id: 'u1', locale: null } } };
    mockUpdate.mockRejectedValue(new Error('offline'));
    await render(<LanguagePicker />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(i18n.language).toBe('en');
    expect(mockPatchUser).not.toHaveBeenCalled();
  });
});

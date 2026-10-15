import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANGUAGE_STORAGE_KEY } from '@taskop/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import i18n from '@/lib/i18n';
import { LanguagePicker } from './language-picker';

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
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_LOCALE, type Language, LANGUAGE_STORAGE_KEY, resolveLanguage } from '@taskop/i18n';
import { getLocales } from 'expo-localization';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';

const warn = (what: string, e: unknown) => console.warn(`[language] ${what}`, e instanceof Error ? e.message : 'unknown error');

/** The language to start in: the stored choice, else the device's languages, else Azerbaijani. Never throws. */
export async function loadLanguage(): Promise<Language> {
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch (e) {
    warn('Could not read the stored language', e);
  }
  let device: string[] = [];
  try {
    device = getLocales().map((l) => l.languageTag);
  } catch (e) {
    warn('Could not read the device languages', e);
  }
  return resolveLanguage(stored, device);
}

/** Applies a language to the UI and remembers it on this phone. Nothing is sent to the server. */
export async function setLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch (e) {
    warn('Could not store the language', e);
  }
}

/** The current UI language for the formatters; the component re-renders when it changes. */
export function useLocale(): Language {
  const { i18n: instance } = useTranslation();
  return (instance.resolvedLanguage ?? instance.language ?? DEFAULT_LOCALE) as Language;
}

/** The current UI language outside React (plain helpers). */
export const currentLanguage = (): Language => (i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE) as Language;

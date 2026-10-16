import { DEFAULT_LOCALE, type Language, LANGUAGE_STORAGE_KEY, resolveLanguage, resources } from '@taskop/i18n';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

/** The stored choice, if any. Storage can be blocked (private mode, policies): then the choice lives for the session. */
function storedLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function applyDocumentLanguage(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}

const initial = resolveLanguage(storedLanguage(), typeof navigator !== 'undefined' ? navigator.languages : []);

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});
applyDocumentLanguage(initial);

/** Switches the UI language and remembers it on this browser. Nothing is sent to the server. */
export async function setLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  applyDocumentLanguage(lng);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Storage blocked: the choice still applies until the page is closed.
  }
}

/** The current UI language, as the formatting helpers expect it ('az', 'en', 'ru'). Re-renders on change. */
export function useLocale(): Language {
  const { i18n: instance } = useTranslation();
  return (instance.resolvedLanguage ?? instance.language ?? DEFAULT_LOCALE) as Language;
}

export default i18n;

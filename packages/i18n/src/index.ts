import { az } from './az/index.js';
import { en } from './en/index.js';
import { ru } from './ru/index.js';

export { az, en, ru };
export type { Translations } from './az/index.js';
export type { Shape } from './shape.js';
export * from './format.js';

/** The UI languages, in the order the selectors list them. Azerbaijani is the source of truth and the default. */
export const LANGUAGES = ['az', 'en', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LOCALE: Language = 'az';
/** Each language's name in itself, which is how a selector should list them. */
export const LANGUAGE_NAMES: Record<Language, string> = { az: 'Azərbaycan dili', en: 'English', ru: 'Русский' };

export const isLanguage = (value: unknown): value is Language => typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

/**
 * The language to start in: the stored choice, else the first of the user's preferred languages Taskop has, else
 * Azerbaijani. `preferred` are BCP 47 tags (`navigator.languages`, the device locales).
 */
export function resolveLanguage(stored: unknown, preferred: readonly string[] = []): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** The storage key both apps and the landing page use for the chosen language. */
export const LANGUAGE_STORAGE_KEY = 'taskop.language';

export const resources = { az: { translation: az }, en: { translation: en }, ru: { translation: ru } } as const;

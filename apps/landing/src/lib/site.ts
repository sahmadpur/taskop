import { az, en, interpolate, type Language, LANGUAGE_NAMES, LANGUAGES, ru } from '@taskop/i18n';
import { PLATFORM_URL } from 'astro:env/client';

export { LANGUAGE_NAMES, LANGUAGES };
export type { Language };

const STRINGS = { az: az.landing, en: en.landing, ru: ru.landing } as const;
/** The landing namespace in one language; the keys are identical in all three (checked by @taskop/i18n's tests). */
export type LandingStrings = (typeof STRINGS)[Language];

export const strings = (lang: Language): LandingStrings => STRINGS[lang];
export const isLanguage = (value: string | undefined): value is Language => (LANGUAGES as readonly string[]).includes(value ?? '');

/** The path of a page in a language: Azerbaijani lives at the root, the others under /en/ and /ru/. */
export const localePath = (lang: Language, path = ''): string => (lang === 'az' ? `/${path}` : `/${lang}/${path}`);

/** Where Login and Sign up go: the platform web app, from PLATFORM_URL. */
export const platformUrl = (path: 'login' | 'signup'): string => `${PLATFORM_URL.replace(/\/$/, '')}/${path}`;

export const siteUrl = 'https://taskop.app';
export const absolute = (path: string): string => `${siteUrl}${path}`;

export const fill = (template: string, vars: Record<string, string | number>): string => interpolate(template, vars);

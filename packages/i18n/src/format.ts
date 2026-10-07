const INTL_LOCALES: Record<string, string> = { az: 'az-Latn-AZ', en: 'en-GB', ru: 'ru-RU', tr: 'tr-TR' };

export const intlLocale = (locale: string): string => INTL_LOCALES[locale] ?? locale;

export interface FormatOptions {
  locale: string;
  timeZone: string;
}

export function formatDateTime(iso: string, { locale, timeZone }: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string, { locale, timeZone }: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone }).format(new Date(iso));
}

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

/** Fills `{{name}}` placeholders; a placeholder without a value stays visible, so a missing variable is noticed. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}

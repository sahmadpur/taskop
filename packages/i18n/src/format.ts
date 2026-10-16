/**
 * Dates, times, numbers and percentages per UI language. Azerbaijani is spelled out here rather than left to `Intl`:
 * Chromium ships no az calendar data (it prints "2026 M10 15, Thu"), and the mobile engines differ, so the same string
 * must come out everywhere. English and Russian use the platform's ICU data.
 */
const INTL_LOCALES: Record<string, string> = { az: 'az-Latn-AZ', en: 'en-GB', ru: 'ru-RU', tr: 'tr-TR' };

export const intlLocale = (locale: string): string => INTL_LOCALES[locale] ?? locale;

export interface FormatOptions {
  locale: string;
  timeZone: string;
}

const AZ_MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];
const AZ_MONTHS_LONG = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
/** Sunday first, as `getUTCDay()` counts. CLDR's abbreviated forms. */
const AZ_WEEKDAYS_SHORT = ['B.', 'B.e.', 'Ç.a.', 'Ç.', 'C.a.', 'C.', 'Ş.'];
const AZ_WEEKDAYS_LONG = ['bazar', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'];

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
  weekday: number;
}

/** The calendar fields of an instant in a time zone, engine-independent (`en-US` numeric data exists everywhere). */
function partsOf(date: Date, timeZone: string): Parts {
  const list = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
    timeZone,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => list.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: get('hour'), minute: get('minute'), weekday: Math.max(0, weekday) };
}


function azDate(p: Parts, { weekday = false, long = false }: { weekday?: boolean; long?: boolean } = {}): string {
  const month = (long ? AZ_MONTHS_LONG : AZ_MONTHS_SHORT)[p.month - 1];
  const base = `${p.day} ${month} ${p.year}`;
  if (!weekday) return base;
  return `${(long ? AZ_WEEKDAYS_LONG : AZ_WEEKDAYS_SHORT)[p.weekday]}, ${base}`;
}

/** "15 okt 2026, 14:00" in the tenant's time zone. */
export function formatDateTime(iso: string, { locale, timeZone }: FormatOptions): string {
  const date = new Date(iso);
  if (locale === 'az') {
    const p = partsOf(date, timeZone);
    return `${azDate(p)}, ${p.hour}:${p.minute}`;
  }
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone }).format(date);
}

/** "15 okt 2026" in the tenant's time zone. */
export function formatDate(iso: string, { locale, timeZone }: FormatOptions): string {
  const date = new Date(iso);
  if (locale === 'az') return azDate(partsOf(date, timeZone));
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone }).format(date);
}

/** "14:00" (24 h) in the tenant's time zone. */
export function formatTime(iso: string, { locale, timeZone }: FormatOptions): string {
  const date = new Date(iso);
  if (locale === 'az') {
    const p = partsOf(date, timeZone);
    return `${p.hour}:${p.minute}`;
  }
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
}

export interface LocalDateOptions {
  /** Prefix the weekday: "Ç., 15 okt 2026". */
  weekday?: boolean;
  /** Spell the month (and weekday) out: "çərşənbə, 15 oktyabr 2026". */
  long?: boolean;
}

/** A calendar date 'YYYY-MM-DD' (an occurrence's local date), never shifted by a time zone. */
export function formatLocalDate(date: string, locale: string, { weekday = false, long = false }: LocalDateOptions = {}): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (locale === 'az') return azDate({ year: y, month: m, day: d, hour: '00', minute: '00', weekday: utc.getUTCDay() }, { weekday, long });
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...(weekday ? { weekday: long ? 'long' : 'short' } : {}),
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

/** "15 okt": a chart tick or a compact list date, for a 'YYYY-MM-DD' calendar date. */
export function formatShortDate(date: string, locale: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (locale === 'az') return `${d} ${AZ_MONTHS_SHORT[m - 1]}`;
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A number in the language's digits and separators (az: "1 234,5"). */
export function formatNumber(value: number, locale: string, options: Intl.NumberFormatOptions = {}): string {
  const text = new Intl.NumberFormat(intlLocale(locale), options).format(value);
  // Engines without az data fall back to "1,234.5"; CLDR az is "1.234,5", and the apps use a space to keep it unambiguous.
  return locale === 'az' ? text.replace(/[.,]/g, (m, i, s) => (i === s.search(/[.,]\d{1,2}$/) ? ',' : ' ')) : text;
}

/** The number part of a percentage with at most one decimal ("85,7"); the UI's own string adds the sign. */
export const formatPercent = (value: number, locale: string): string => formatNumber(value, locale, { maximumFractionDigits: 1 });

/** Fills `{{name}}` placeholders; a placeholder without a value stays visible, so a missing variable is noticed. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}

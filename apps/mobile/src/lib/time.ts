import { intlLocale } from '@taskop/i18n';

/** HH:MM in the tenant's time zone (24 h). */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale('az'), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

/** The tenant-local calendar date of an instant, as YYYY-MM-DD (the form of `localDate` on occurrences). */
export function localDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

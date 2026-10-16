import { formatDateTime } from '@taskop/i18n';
import { useCallback } from 'react';
import { useMe } from './session';
import { useLocale } from '@/lib/i18n';

export function useFormatDateTime(): (iso: string) => string {
  const { tenant } = useMe();
  const locale = useLocale();
  return useCallback((iso: string) => formatDateTime(iso, { locale: locale, timeZone: tenant.timezone }), [locale, tenant.timezone]);
}

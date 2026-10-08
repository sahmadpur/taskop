import { formatDateTime } from '@taskop/i18n';
import { useCallback } from 'react';
import { useMe } from './session';

export function useFormatDateTime(): (iso: string) => string {
  const { tenant } = useMe();
  return useCallback((iso: string) => formatDateTime(iso, { locale: tenant.locale, timeZone: tenant.timezone }), [tenant.locale, tenant.timezone]);
}

import { ApiError } from '@taskop/api-client';
import type { TFunction } from 'i18next';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

export function errorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const minutes = e.retryAfterSeconds ? Math.ceil(e.retryAfterSeconds / 60) : 1;
    return t(e.messageKey, { minutes, requestId: e.requestId ?? '—' });
  }
  return t('errors.INTERNAL', { requestId: '—' });
}

/** Puts API field errors (i18n keys) onto the matching form inputs. Returns true if any were applied. */
export function applyFieldErrors<T extends FieldValues>(form: UseFormReturn<T>, e: unknown): boolean {
  if (!(e instanceof ApiError) || !e.fields) return false;
  const entries = Object.entries(e.fields);
  for (const [name, key] of entries) form.setError(name as Path<T>, { type: 'server', message: key });
  return entries.length > 0;
}

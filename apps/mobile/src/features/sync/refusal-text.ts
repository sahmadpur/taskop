import type { TFunction } from 'i18next';

/** The reason behind an i18n error key (`errors.*` keys may interpolate a request id the phone does not have). */
const reason = (t: TFunction, errorKey: string): string => t(errorKey, { requestId: '—' });

/** "Server qəbul etmədi: …" for an execution whose work the server refused for good. */
export const notAcceptedText = (t: TFunction, errorKey: string): string => t('mobile.sync.notAccepted', { reason: reason(t, errorKey) });

/** "Server bu faylı qəbul etmədi: …" on the item of a medium the server refused for good. */
export const fileNotAcceptedText = (t: TFunction, errorKey: string): string => t('mobile.sync.fileNotAccepted', { reason: reason(t, errorKey) });

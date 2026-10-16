import type { Language } from '@taskop/i18n';
import { setLanguage } from './i18n';
import { api, session } from './session';

/**
 * The language selector's action: the UI switches and this browser remembers the choice at once; a signed-in user's
 * profile is updated too, so e-mails, push, PDFs and exports follow, and so another device picks the same language on
 * sign-in. A failed save keeps the local choice (the server's text falls back to the tenant's language).
 */
export async function chooseLanguage(lng: Language): Promise<void> {
  await setLanguage(lng);
  const s = session.get();
  if (s.status !== 'authenticated') return;
  try {
    const saved = await api.preferences.update({ locale: lng });
    const now = session.get();
    // The answer must not land on whoever signed in since (the dialog pattern of preferences-dialog.tsx).
    if (now.status === 'authenticated' && now.me.user.id === s.me.user.id) session.setMe({ ...now.me, user: { ...now.me.user, locale: saved.locale } });
  } catch {
    // Offline or refused: the local choice stands.
  }
}

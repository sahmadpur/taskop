import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { api, useMe } from '@/lib/session';

export function VerifyEmailBanner() {
  const { t } = useTranslation();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (me.user.kind !== 'staff' || me.user.emailVerified) return null;
  return (
    <div className="bg-status-late-soft text-status-late-text flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-sm lg:px-6">
      <span>{t('auth.verifyBanner.text')}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.auth.resendVerification();
            toast.success(t('auth.verifyBanner.sent'));
          } catch (e) {
            toast.error(errorText(t, e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('auth.verifyBanner.resend')}
      </Button>
    </div>
  );
}

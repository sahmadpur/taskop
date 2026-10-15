import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { errorText } from '@/lib/errors';
import { api, session, useMe } from '@/lib/session';
import { EmptyState } from '@/components/states';

/** Spec §8, B-12: the user's only notification setting is the e-mail opt-out; push is muted in the phone's settings. */
export function NotificationPreferencesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notifications.preferences.title')}</DialogTitle>
          <DialogDescription>{t('notifications.preferences.description')}</DialogDescription>
        </DialogHeader>
        <EmailSwitch />
      </DialogContent>
    </Dialog>
  );
}

function EmailSwitch() {
  const { t } = useTranslation();
  const me = useMe();
  const save = useMutation({
    mutationFn: ({ emailNotifications }: { emailNotifications: boolean; userId: string }) => api.preferences.update({ emailNotifications }),
    onSuccess: (saved, { userId }) => {
      // The session may have moved on (refresh, sign-out/in) while the request was in flight: patch what it holds now, for the same user only.
      const now = session.get();
      if (now.status !== 'authenticated' || now.me.user.id !== userId) return;
      session.setMe({ ...now.me, user: { ...now.me.user, emailNotifications: saved.emailNotifications } });
      toast.success(t('notifications.preferences.saved'));
    },
  });
  // Only the value being saved overrides the session; otherwise the switch follows the session profile, which refreshes underneath.
  const pending = save.isPending ? save.variables.emailNotifications : undefined;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="preferences-email">{t('notifications.preferences.email')}</Label>
        <Switch
          id="preferences-email"
          checked={pending ?? me.user.emailNotifications}
          disabled={save.isPending}
          onCheckedChange={(v) => save.mutate({ emailNotifications: v, userId: me.user.id })}
        />
      </div>
      {!me.user.email && <EmptyState title={t('notifications.preferences.noEmail')} />}
      <FormError message={save.isError ? errorText(t, save.error) : null} />
    </div>
  );
}

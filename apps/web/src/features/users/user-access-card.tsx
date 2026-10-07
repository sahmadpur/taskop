import type { UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { SecretBlock } from './secret-dialog';
import { loginLabel, statusVariant } from './user-labels';

interface Props {
  user: UserDto;
  orgCode: string;
  isSelf: boolean;
  canManage: boolean;
  onChanged: (user: UserDto) => void;
}

export function UserAccessCard({ user, orgCode, isSelf, canManage, onChanged }: Props) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState<string | null>(null);
  const run = async (fn: () => Promise<UserDto>) => {
    try {
      onChanged(await fn());
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.detail.access')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">{loginLabel(user)}</span>
          <Badge variant={statusVariant(user.status)}>{t(`users.statuses.${user.status}`)}</Badge>
        </div>
        {isSelf && <p className="text-muted-foreground text-sm">{t('users.detail.you')}</p>}
        {canManage && !isSelf && (
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              label={t('users.detail.resetCredential')}
              title={t('users.detail.resetCredential')}
              description={t('users.detail.confirmReset', { name: user.fullName })}
              onConfirm={async () => {
                try {
                  const result = await api.users.resetCredential(user.id, {});
                  if (result.generatedSecret) setSecret(result.generatedSecret);
                  else toast.success(t('users.detail.resetStaffSent'));
                  onChanged(result.user);
                } catch (e) {
                  toast.error(errorText(t, e));
                }
              }}
            />
            {user.status === 'deactivated' ? (
              <Button variant="outline" onClick={() => void run(() => api.users.reactivate(user.id))}>
                {t('users.detail.reactivate')}
              </Button>
            ) : (
              <ConfirmButton
                variant="destructive"
                label={t('users.detail.deactivate')}
                title={t('users.detail.deactivate')}
                description={t('users.detail.confirmDeactivate', { name: user.fullName })}
                onConfirm={() => run(() => api.users.deactivate(user.id))}
              />
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.secret.title')}</DialogTitle>
          </DialogHeader>
          {secret && <SecretBlock orgCode={orgCode} username={user.username ?? ''} secret={secret} />}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{t('users.secret.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

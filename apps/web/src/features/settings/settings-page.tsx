import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, useCan } from '@/lib/session';
import { ChangePasswordForm } from './change-password-form';
import { OrgSettingsForm } from './org-settings-form';

export function SettingsPage() {
  const { t } = useTranslation();
  const canEdit = useCan('tenant.manage');
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  return (
    <div className="grid gap-6">
      <PageHeader title={t('settings.title')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.org.title')}</CardTitle>
        </CardHeader>
        <CardContent>{tenant.data ? <OrgSettingsForm tenant={tenant.data} canEdit={canEdit} /> : <p>{t('common.loading')}</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.password.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}

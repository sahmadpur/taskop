import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PlatformTenantWorkspace } from '@/features/checklists/workspace';
import { platformApi } from './platform-session';

export function PlatformTenantWorkspaceRoute() {
  const { t } = useTranslation();
  const { tenantId } = useParams({ strict: false }) as { tenantId: string };
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', ''],
    queryFn: async () => (await platformApi.tenants.list({ limit: 200 })).items,
  });
  const name = tenants.data?.find((x) => x.id === tenantId)?.name ?? tenantId;
  return (
    <PlatformTenantWorkspace tenantId={tenantId}>
      <Alert className="mb-4">
        <AlertDescription className="flex items-center gap-3">
          {t('platform.workspaceBanner', { name })}
          <a href="/platform/tenants" className="underline">
            {t('platform.backToTenants')}
          </a>
        </AlertDescription>
      </Alert>
      <Outlet />
    </PlatformTenantWorkspace>
  );
}

import { Outlet, useParams } from '@tanstack/react-router';
import { ChecklistDraftPage, ChecklistVersionPage } from './editor-pages';
import { ChecklistsPage } from './checklists-page';
import { TenantWorkspace } from './workspace';

export function TenantWorkspaceLayout() {
  return (
    <TenantWorkspace>
      <Outlet />
    </TenantWorkspace>
  );
}

export { ChecklistsPage };


type Params = { checklistId?: string; versionId?: string; source?: string; templateId?: string; tenantId?: string };
const useIds = () => useParams({ strict: false }) as Params;

export function ChecklistDraftRoute() {
  return <ChecklistDraftPage checklistId={useIds().checklistId!} />;
}
export function ChecklistVersionRoute() {
  const p = useIds();
  return <ChecklistVersionPage checklistId={p.checklistId!} versionId={p.versionId!} />;
}

import { Outlet, useParams } from '@tanstack/react-router';
import { ChecklistDetailPage } from './checklist-detail-page';
import { ChecklistDraftPage, ChecklistVersionPage, TemplateEditorPage } from './editor-pages';
import { TemplatesPage } from './templates-page';
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

export function ChecklistDetailRoute() {
  return <ChecklistDetailPage checklistId={useIds().checklistId!} />;
}
export function TemplateEditorRoute() {
  const p = useIds();
  return <TemplateEditorPage source={p.source === 'global' ? 'global' : 'tenant'} templateId={p.templateId!} />;
}
export { TemplatesPage };

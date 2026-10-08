import { Outlet } from '@tanstack/react-router';
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

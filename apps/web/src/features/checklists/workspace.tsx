import type { ChecklistsApi, TemplatesApi } from '@taskop/api-client';
import { useNavigate } from '@tanstack/react-router';
import { createContext, type MouseEvent, type ReactNode, useContext, useMemo } from 'react';
import { platformApi } from '@/features/platform/platform-session';
import { api, useCan, useMe } from '@/lib/session';

export interface ChecklistWorkspace {
  checklists: ChecklistsApi;
  templates: TemplatesApi;
  can: { manage: boolean; publish: boolean; templates: boolean };
  /** Route prefix: '' for tenant users, `/platform/tenants/<id>` for platform admins. */
  base: string;
  /** Query-key scope so tenant and platform caches never mix. */
  scope: string;
  timeZone: string;
  /** Navigate to a path relative to `base`. */
  go: (to: string) => void;
}

const WorkspaceContext = createContext<ChecklistWorkspace | null>(null);

export function useWorkspace(): ChecklistWorkspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace() used outside a checklist workspace');
  return ws;
}

export function WorkspaceProvider({ value, children }: { value: ChecklistWorkspace; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function TenantWorkspace({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const me = useMe();
  const manage = useCan('checklists.manage');
  const publish = useCan('checklists.publish');
  const templates = useCan('templates.manage');
  const value = useMemo<ChecklistWorkspace>(
    () => ({
      checklists: api.checklists,
      templates: api.templates,
      can: { manage, publish, templates },
      base: '',
      scope: 'tenant',
      timeZone: me.tenant.timezone,
      go: (to) => void navigate({ to: to as '/' }),
    }),
    [manage, publish, templates, me.tenant.timezone, navigate],
  );
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}

export function PlatformTenantWorkspace({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const navigate = useNavigate();
  const value = useMemo<ChecklistWorkspace>(() => {
    const base = `/platform/tenants/${tenantId}`;
    return {
      ...platformApi.inTenant(tenantId),
      can: { manage: true, publish: true, templates: true },
      base,
      scope: `platform:${tenantId}`,
      timeZone: 'Asia/Baku',
      go: (to) => void navigate({ to: `${base}${to}` as '/' }),
    };
  }, [tenantId, navigate]);
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}

/** An <a> that navigates inside the current workspace (keeps cmd/ctrl-click working). */
export function WsLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const ws = useWorkspace();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    ws.go(to);
  };
  return (
    <a href={`${ws.base}${to}`} onClick={onClick} className={className ?? 'font-medium hover:underline'}>
      {children}
    </a>
  );
}

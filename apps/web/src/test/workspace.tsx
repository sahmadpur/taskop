import type { ChecklistsApi, TemplatesApi } from '@taskop/api-client';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { type ChecklistWorkspace, WorkspaceProvider } from '@/features/checklists/workspace';
import { renderWithProviders } from './render';

const fns = <T extends string>(...names: T[]) => Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<T, ReturnType<typeof vi.fn>>;

export function fakeWorkspace(overrides: Partial<ChecklistWorkspace> = {}): ChecklistWorkspace & {
  checklists: Record<keyof ChecklistsApi, ReturnType<typeof vi.fn>>;
  templates: Record<keyof TemplatesApi, ReturnType<typeof vi.fn>>;
  go: ReturnType<typeof vi.fn>;
} {
  return {
    checklists: fns('list', 'get', 'create', 'update', 'version', 'draft', 'startDraft', 'saveDraft', 'discardDraft', 'publish', 'deactivate', 'reactivate', 'saveAsTemplate'),
    templates: fns('list', 'get', 'create', 'update', 'saveContent', 'deactivate', 'reactivate'),
    can: { manage: true, publish: true, templates: true },
    base: '',
    scope: 'test',
    timeZone: 'Asia/Baku',
    go: vi.fn(),
    ...overrides,
  } as never;
}

export function renderInWorkspace(ui: ReactElement, ws = fakeWorkspace()) {
  return { ws, ...renderWithProviders(<WorkspaceProvider value={ws}>{ui}</WorkspaceProvider>) };
}

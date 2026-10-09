import type { ChecklistSummary } from '@taskop/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { ChecklistsPage } from './checklists-page';

const row = (over: Partial<ChecklistSummary> = {}): ChecklistSummary => ({
  id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01',
  name: 'Gündəlik təmizlik',
  description: null,
  category: 'cleaning',
  status: 'active',
  currentVersionNumber: 2,
  draftRevision: 3,
  updatedAt: '2026-10-08T08:00:00.000Z',
  ...over,
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('ChecklistsPage', () => {
  it('lists checklists with version and draft badges and filters by search', async () => {
    const ws = fakeWorkspace();
    ws.checklists.list.mockResolvedValue({ items: [row(), row({ id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02', name: 'Anbar', currentVersionNumber: null })], nextCursor: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    expect(await screen.findByText('Gündəlik təmizlik')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('Dərc edilməyib')).toBeInTheDocument();
    expect(screen.getAllByText('Qaralama')).toHaveLength(2);
    await userEvent.type(screen.getByRole('searchbox'), 'anb');
    await waitFor(() => expect(ws.checklists.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'anb', status: 'active' })));
  });

  it('creates a blank checklist and opens its draft', async () => {
    const ws = fakeWorkspace();
    ws.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
    ws.checklists.create.mockResolvedValue({ ...row(), id: 'new-id', versions: [], currentVersionId: null, source: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni yoxlama vərəqəsi' }));
    await userEvent.type(screen.getByLabelText('Ad'), 'Mətbəx yoxlaması');
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'restaurant');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.checklists.create).toHaveBeenCalledWith({ name: 'Mətbəx yoxlaması', category: 'restaurant' }));
    expect(ws.go).toHaveBeenCalledWith('/checklists/new-id/draft');
  });

  it('creates from a template with the template name prefilled', async () => {
    const ws = fakeWorkspace();
    ws.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
    ws.templates.list.mockResolvedValue([
      { id: 't1', source: 'global', name: 'Restoran mətbəxi', description: null, category: 'restaurant', status: 'active', itemCount: 11, updatedAt: '2026-10-08T08:00:00.000Z' },
    ]);
    ws.checklists.create.mockResolvedValue({ ...row(), id: 'c9', versions: [], currentVersionId: null, source: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni yoxlama vərəqəsi' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Şablondan' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Restoran mətbəxi/ }));
    expect(screen.getByLabelText('Ad')).toHaveValue('Restoran mətbəxi');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.checklists.create).toHaveBeenCalledWith({ name: 'Restoran mətbəxi', category: 'restaurant', from: { kind: 'global', templateId: 't1' } }));
  });

  it('hides the create button without checklists.manage', async () => {
    const ws = fakeWorkspace({ can: { manage: false, publish: false, templates: false } });
    ws.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    expect(await screen.findByText('Hələ yoxlama vərəqəsi yoxdur.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yeni yoxlama vərəqəsi' })).toBeNull();
  });
});

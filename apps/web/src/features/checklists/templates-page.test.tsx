import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { TemplatesPage } from './templates-page';

const tpl = (id: string, source: 'global' | 'tenant', name: string, status: 'active' | 'deactivated' = 'active') => ({
  id, source, name, description: null, category: 'restaurant' as const, status, itemCount: 11, updatedAt: '2026-10-08T08:00:00.000Z',
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('TemplatesPage', () => {
  it('uses a Taskop template to create a checklist', async () => {
    const ws = fakeWorkspace();
    ws.templates.list.mockImplementation(async (q: { source?: string }) => (q.source === 'global' ? [tpl('g1', 'global', 'Restoran mətbəxi')] : []));
    ws.checklists.create.mockResolvedValue({ id: 'c1' });
    renderInWorkspace(<TemplatesPage />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'İstifadə et' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.checklists.create).toHaveBeenCalledWith({ name: 'Restoran mətbəxi', category: 'restaurant', from: { kind: 'global', templateId: 'g1' } }));
    expect(ws.go).toHaveBeenCalledWith('/checklists/c1/draft');
  });

  it('manages own templates', async () => {
    const ws = fakeWorkspace();
    ws.templates.list.mockImplementation(async (q: { source?: string }) => (q.source === 'tenant' ? [tpl('t1', 'tenant', 'Bizim', 'deactivated')] : []));
    ws.templates.reactivate.mockResolvedValue({});
    ws.templates.create.mockResolvedValue({ id: 't2' });
    renderInWorkspace(<TemplatesPage />, ws);
    await userEvent.click(screen.getByRole('tab', { name: 'Bizim şablonlar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aktiv et' }));
    expect(ws.templates.reactivate).toHaveBeenCalledWith('t1');
    await userEvent.click(screen.getByRole('button', { name: 'Yeni şablon' }));
    await userEvent.type(screen.getByLabelText('Ad'), 'Növbə təhvili');
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'other');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.templates.create).toHaveBeenCalledWith({ name: 'Növbə təhvili', category: 'other' }));
    expect(ws.go).toHaveBeenCalledWith('/templates/tenant/t2');
  });

  it('hides template management without templates.manage', async () => {
    const ws = fakeWorkspace({ can: { manage: true, publish: true, templates: false } });
    ws.templates.list.mockImplementation(async (q: { source?: string }) =>
      q.source === 'tenant'
        ? [tpl('t1', 'tenant', 'Bizim'), tpl('t2', 'tenant', 'Digər', 'deactivated')]
        : [],
    );
    renderInWorkspace(<TemplatesPage />, ws);
    await userEvent.click(screen.getByRole('tab', { name: 'Bizim şablonlar' }));
    await screen.findByText('Bizim');
    expect(screen.queryByRole('button', { name: 'Yeni şablon' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deaktiv et' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aktiv et' })).toBeNull();
  });
});

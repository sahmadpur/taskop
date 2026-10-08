import type { ChecklistDetail } from '@taskop/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { ChecklistDetailPage } from './checklist-detail-page';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
const V1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e11';
const V2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e12';
const detail = (over: Partial<ChecklistDetail> = {}): ChecklistDetail => ({
  id: ID,
  name: 'Gündəlik təmizlik',
  description: null,
  category: 'cleaning',
  status: 'active',
  currentVersionNumber: 2,
  draftRevision: null,
  updatedAt: '2026-10-08T08:00:00.000Z',
  currentVersionId: V2,
  source: { kind: 'global', id: ID },
  versions: [
    { id: V2, number: 2, state: 'published', changeNote: 'Sual əlavə edildi', publishedAt: '2026-10-08T08:00:00.000Z', publishedBy: { kind: 'user', name: 'Elvin' }, createdAt: '2026-10-08T07:00:00.000Z' },
    { id: V1, number: 1, state: 'published', changeNote: null, publishedAt: '2026-10-07T08:00:00.000Z', publishedBy: { kind: 'platform', name: null }, createdAt: '2026-10-07T07:00:00.000Z' },
  ],
  ...over,
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('ChecklistDetailPage', () => {
  it('shows version history with publisher and source', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('v2')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Elvin')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Taskop')).toBeInTheDocument();
    expect(screen.getByText('Taskop şablonundan yaradılıb')).toBeInTheDocument();
  });

  it('starts a draft from the current version when editing', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.startDraft.mockResolvedValue({});
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'Redaktə et' }));
    await waitFor(() => expect(ws.checklists.startDraft).toHaveBeenCalledWith(ID));
    expect(ws.go).toHaveBeenCalledWith(`/checklists/${ID}/draft`);
  });

  it('restores an old version and saves a version as a template', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.startDraft.mockResolvedValue({});
    ws.checklists.saveAsTemplate.mockResolvedValue({});
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Qaralama kimi bərpa et' }));
    await waitFor(() => expect(ws.checklists.startDraft).toHaveBeenCalledWith(ID, { fromVersionId: V1 }));
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Şablon kimi saxla' }));
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'safety');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(ws.checklists.saveAsTemplate).toHaveBeenCalledWith(ID, V2, { name: 'Gündəlik təmizlik', category: 'safety', description: null }));
  });

  it('is read-only when deactivated and offers reactivate', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail({ status: 'deactivated' }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    expect(await screen.findByText('Bu yoxlama vərəqəsi deaktivdir və dəyişdirilə bilməz.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redaktə et' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aktiv et' })).toBeInTheDocument();
  });
});

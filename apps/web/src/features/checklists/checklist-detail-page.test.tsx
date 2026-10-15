import { ApiError } from '@taskop/api-client';
import type { ChecklistDetail } from '@taskop/contracts';
import { az } from '@taskop/i18n';
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
  requiresAudit: false,
  auditReportEmails: [],
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

  it('hides every management action without checklists.manage', async () => {
    const ws = fakeWorkspace({ can: { manage: false, publish: false, templates: true } });
    ws.checklists.get.mockResolvedValue(detail());
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    await screen.findAllByRole('row');
    for (const name of [
      'Redaktə et',
      'Qaralamaya davam et',
      'Məlumatları dəyiş',
      'Qaralama kimi bərpa et',
      'Deaktiv et',
      'Kopyala',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('hides save-as-template without templates.manage', async () => {
    const ws = fakeWorkspace({ can: { manage: true, publish: true, templates: false } });
    ws.checklists.get.mockResolvedValue(detail());
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    await screen.findAllByRole('row');
    expect(screen.queryByRole('button', { name: 'Şablon kimi saxla' })).toBeNull();
  });

  it('continues the existing draft and offers no restore', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail({ draftRevision: 3 }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    expect(await screen.findByRole('button', { name: 'Qaralamaya davam et' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redaktə et' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Qaralama kimi bərpa et' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Qaralamanı sil' })).toBeInTheDocument();
  });

  it('offers no edit, restore, details or discard when deactivated', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail({ status: 'deactivated', draftRevision: 3 }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    await screen.findAllByRole('row');
    for (const name of [
      'Qaralama kimi bərpa et',
      'Məlumatları dəyiş',
      'Qaralamanı sil',
      'Qaralamaya davam et',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('saves the audit requirement and the report addresses', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValueOnce(detail({ auditReportEmails: ['rehber@acme.az'] })).mockResolvedValue(
      detail({ requiresAudit: true, auditReportEmails: ['rehber@acme.az', 'audit@acme.az'] }),
    );
    ws.checklists.update.mockResolvedValue({});
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    const toggle = within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit });
    expect(toggle).not.toBeChecked();
    expect(within(audit).getByText('rehber@acme.az')).toBeInTheDocument();
    const save = within(audit).getByRole('button', { name: 'Yadda saxla' });
    expect(save).toBeDisabled();
    await userEvent.click(toggle);
    await userEvent.type(within(audit).getByLabelText(az.audits.fields.reportEmails), 'Audit@Acme.az{Enter}');
    await userEvent.click(save);
    await waitFor(() => expect(ws.checklists.update).toHaveBeenCalledWith(ID, { requiresAudit: true, auditReportEmails: ['rehber@acme.az', 'audit@acme.az'] }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Audit' })).getByRole('switch', { name: az.audits.fields.requiresAudit })).toBeChecked());
    expect(within(screen.getByRole('region', { name: 'Audit' })).getByRole('button', { name: 'Yadda saxla' })).toBeDisabled();
  });

  it('shows the API’s reason for one refused address', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.update.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { 'auditReportEmails.0': 'errors.validation.email' }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    await userEvent.click(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit }));
    await userEvent.click(within(audit).getByRole('button', { name: 'Yadda saxla' }));
    expect(await within(audit).findByText('Düzgün e-poçt ünvanı daxil edin.')).toBeInTheDocument();
  });

  it('shows the API’s reason for a refused address list', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.update.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { auditReportEmails: 'audits.issues.tooManyEmails' }),
    );
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    await userEvent.click(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit }));
    await userEvent.click(within(audit).getByRole('button', { name: 'Yadda saxla' }));
    expect(await within(audit).findByText(az.audits.issues.tooManyEmails)).toBeInTheDocument();
  });

  it('shows the audit settings read-only without checklists.manage or on a deactivated checklist', async () => {
    const ws = fakeWorkspace({ can: { manage: false, publish: false, templates: false } });
    ws.checklists.get.mockResolvedValue(detail({ requiresAudit: true, auditReportEmails: ['rehber@acme.az'] }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    expect(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit })).toBeDisabled();
    expect(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit })).toBeChecked();
    expect(within(audit).getByText('rehber@acme.az')).toBeInTheDocument();
    expect(within(audit).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(audit).queryByRole('button', { name: 'Yadda saxla' })).not.toBeInTheDocument();
  });
});

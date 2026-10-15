import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meWith } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AuditScreen } from './audit-screen';
import { apiError, AUDIT_IDS, auditFixture, verdict } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    audits: { get: vi.fn(), setVerdict: vi.fn(), clearVerdict: vi.fn(), finish: vi.fn(), cancel: vi.fn(), sendReport: vi.fn(), downloadReport: vi.fn() },
    media: { url: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const renderScreen = () => renderWithRouter(<AuditScreen id={AUDIT_IDS.audit} />, `/audits/${AUDIT_IDS.audit}`);
const itemButton = (label: string) => within(screen.getByRole('navigation', { name: 'Bəndlər' })).getByRole('button', { name: label });
const finishButton = () => screen.getByRole('button', { name: az.audits.actions.finish });

/** Every auditable item reviewed; "Temperatur" rejected. */
function allReviewed() {
  const f = auditFixture();
  const verdicts = f.auditableItemIds.map((id) => (id === f.temp.id ? verdict(id, 'rejected', 'Normadan yüksək') : verdict(id, 'approved')));
  return { f, detail: f.detail({ verdicts }) };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(['audits.perform']);
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('finishing an audit', () => {
  it('highlights the items without a verdict instead of finishing', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(
      f.detail({ verdicts: [f.problem.id, f.comment.id, f.temp.id, f.photo.id].map((id) => verdict(id, 'approved')) }),
    );
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('2 bənd hələ qiymətləndirilməyib.')).toBeInTheDocument();
    expect(itemButton('Video')).toHaveAttribute('data-missing', 'true');
    expect(itemButton('Qeyd')).toHaveAttribute('data-missing', 'true');
    expect(itemButton('Temperatur')).not.toHaveAttribute('data-missing');
    expect(itemButton('Video')).toHaveAttribute('aria-current', 'true');
    expect(mocks.api.audits.finish).not.toHaveBeenCalled();
  });

  it('finishes with the result, the comment and extra addresses', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, status: 'finished', result: 'failed', reportStatus: 'pending' });
    mocks.api.audits.finish.mockResolvedValue({ ...detail, status: 'finished' });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    expect(within(dialog).getByText('rehber@acme.az')).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Auditi bitir' });
    expect(submit).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.failed }));
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.comment), 'Temperatur normadan yüksəkdir');
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.extraEmails), 'Audit@Acme.az{Enter}');
    await userEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.api.audits.finish).toHaveBeenCalledWith(AUDIT_IDS.audit, { result: 'failed', comment: 'Temperatur normadan yüksəkdir', extraEmails: ['audit@acme.az'] });
    // Finished: read-only, with the result and no more actions.
    expect(await screen.findByText(az.audits.statuses.finished)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.finish })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.approve })).not.toBeInTheDocument();
  });

  it('highlights the items the server still misses', async () => {
    const { f, detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    mocks.api.audits.finish.mockRejectedValue(apiError(422, 'AUDIT_INCOMPLETE', { itemIds: [f.note.id] }));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('1 bənd hələ qiymətləndirilməyib.')).toBeInTheDocument();
    expect(itemButton('Qeyd')).toHaveAttribute('data-missing', 'true');
    expect(itemButton('Qeyd')).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the dialog open with the reason when the run was sent back meanwhile', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    mocks.api.audits.finish.mockRejectedValue(apiError(409, 'AUDIT_PAUSED'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    expect(await within(dialog).findByText(az.errors.AUDIT_PAUSED)).toBeInTheDocument();
  });

  it('keeps the dialog open while a photo or video is still uploading', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    // Part 1 decision 29: the spec's "media pending" refusal.
    mocks.api.audits.finish.mockRejectedValue(apiError(422, 'MEDIA_NOT_FOUND_IN_STORAGE'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    expect(await within(dialog).findByText(az.errors.MEDIA_NOT_FOUND_IN_STORAGE)).toBeInTheDocument();
  });

  it('refuses a merged recipient list over the limit without asking the server', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    // The checklist's rehber@acme.az plus 20 others is 21 addresses.
    const twenty = Array.from({ length: 20 }, (_, i) => `u${i}@acme.az`).join(' ');
    await userEvent.click(within(dialog).getByLabelText(az.audits.fields.extraEmails));
    await userEvent.paste(twenty);
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    expect(await within(dialog).findByText(az.audits.issues.tooManyEmails)).toBeInTheDocument();
    expect(mocks.api.audits.finish).not.toHaveBeenCalled();
  });

  it('does not offer finishing while the run is with the worker', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue({ ...detail, paused: true });
    renderScreen();
    expect(await screen.findByText(az.audits.paused)).toBeInTheDocument();
    expect(finishButton()).toBeDisabled();
  });

  it('cancels the audit with a reason', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, status: 'cancelled', cancelReason: 'Səhv icra seçilib' });
    mocks.api.audits.cancel.mockResolvedValue({ ...detail, status: 'cancelled' });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.cancel }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi ləğv et' });
    const submit = within(dialog).getByRole('button', { name: 'Auditi ləğv et' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.cancelReason), 'Səhv icra seçilib');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.api.audits.cancel).toHaveBeenCalledWith(AUDIT_IDS.audit, { reason: 'Səhv icra seçilib' }));
    expect(await screen.findByText(az.audits.statuses.cancelled)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.cancel })).not.toBeInTheDocument();
  });

  it('offers neither finish nor cancel to a report viewer', async () => {
    mocks.me.current = meWith(['reports.view']);
    mocks.api.audits.get.mockResolvedValue(allReviewed().detail);
    renderScreen();
    await screen.findByRole('navigation', { name: 'Bəndlər' });
    expect(screen.queryByRole('button', { name: az.audits.actions.finish })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.cancel })).not.toBeInTheDocument();
  });
});

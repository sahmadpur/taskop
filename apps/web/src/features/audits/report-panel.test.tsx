import type { AuditDetail } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meWith } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AuditScreen } from './audit-screen';
import { apiError, AUDIT_IDS, auditFixture, verdict } from './fixtures';
import { REPORT_POLL_LIMIT_MS, REPORT_POLL_MS } from './labels';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { audits: { get: vi.fn(), sendReport: vi.fn(), downloadReport: vi.fn() }, media: { url: vi.fn() } },
  saveFile: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));
vi.mock('@/features/reports/download', () => ({ saveFile: mocks.saveFile }));

const FILE = { blob: new Blob(['%PDF-1.7']), filename: 'taskop-audit-acilis-2026-11-02.pdf' };

/** A failed audit finished at 15:00 Baku, its report in `reportStatus`. */
function finished(over: Partial<AuditDetail> = {}): AuditDetail {
  const f = auditFixture();
  return f.detail({
    status: 'finished',
    result: 'failed',
    score: { approved: 5, rejected: 1, reviewed: 6, percent: 83.3 },
    finishedAt: '2026-11-02T11:00:00.000Z',
    comment: 'Temperatur normadan yüksəkdir',
    verdicts: f.auditableItemIds.map((id) => verdict(id, id === f.temp.id ? 'rejected' : 'approved', id === f.temp.id ? 'Yüksək' : null)),
    reportStatus: 'ready',
    reportRecipients: ['rehber@acme.az'],
    reportSentAt: '2026-11-02T11:01:00.000Z',
    ...over,
  });
}

const renderScreen = () => renderWithRouter(<AuditScreen id={AUDIT_IDS.audit} />, `/audits/${AUDIT_IDS.audit}`);
const report = () => screen.getByRole('region', { name: 'Audit hesabatı' });
const download = () => within(report()).getByRole('button', { name: az.audits.actions.downloadReport });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(['audits.perform']);
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
  mocks.api.audits.downloadReport.mockResolvedValue(FILE);
});
afterEach(() => vi.useRealTimers());

describe('the audit report', () => {
  it('shows the result, the recipients and the send time, and downloads the PDF', async () => {
    mocks.api.audits.get.mockResolvedValue(finished());
    renderScreen();
    expect(await screen.findByText(az.audits.results.failed)).toBeInTheDocument();
    expect(screen.getByText(`${az.audits.score}: 83,3%`)).toBeInTheDocument();
    expect(report()).toHaveTextContent(az.audits.reportStatuses.ready);
    expect(report()).toHaveTextContent('rehber@acme.az');
    expect(report()).toHaveTextContent('15:01');
    await userEvent.click(download());
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledWith(FILE));
    expect(mocks.api.audits.downloadReport).toHaveBeenCalledWith(AUDIT_IDS.audit);
  });

  it('asks again every 3 s while the report is built, then offers the PDF', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.api.audits.get.mockResolvedValueOnce(finished({ reportStatus: 'pending', reportSentAt: null })).mockResolvedValue(finished());
    renderScreen();
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
    expect(download()).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(REPORT_POLL_MS));
    await waitFor(() => expect(download()).toBeEnabled());
    expect(screen.queryByText('Hesabat hazırlanır…')).not.toBeInTheDocument();
    expect(mocks.api.audits.get).toHaveBeenCalledTimes(2);
  });

  it('stops asking after 60 s and asks again on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.api.audits.get.mockResolvedValue(finished({ reportStatus: 'pending', reportSentAt: null }));
    renderScreen();
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(REPORT_POLL_LIMIT_MS + REPORT_POLL_MS));
    expect(await screen.findByText('Hesabat hələ hazır deyil. Bir az sonra yenidən yoxlayın.')).toBeInTheDocument();
    const calls = mocks.api.audits.get.mock.calls.length;
    expect(calls).toBeGreaterThan(10);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.api.audits.get).toHaveBeenCalledTimes(calls);
    await user.click(screen.getByRole('button', { name: 'Yenidən yoxla' }));
    await waitFor(() => expect(mocks.api.audits.get.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
  });

  it('waits again when the download says the report is not ready', async () => {
    mocks.api.audits.get.mockResolvedValueOnce(finished()).mockResolvedValue(finished({ reportStatus: 'pending' }));
    mocks.api.audits.downloadReport.mockRejectedValue(apiError(409, 'REPORT_NOT_READY'));
    renderScreen();
    await screen.findByRole('region', { name: 'Audit hesabatı' });
    await userEvent.click(download());
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it('retries a failed report', async () => {
    mocks.api.audits.get.mockResolvedValueOnce(finished({ reportStatus: 'failed', reportSentAt: null })).mockResolvedValue(finished({ reportStatus: 'pending' }));
    mocks.api.audits.sendReport.mockResolvedValue(finished({ reportStatus: 'pending' }));
    renderScreen();
    expect(await screen.findByText('Hesabat yaradıla bilmədi.')).toBeInTheDocument();
    expect(download()).toBeDisabled();
    await userEvent.click(within(report()).getByRole('button', { name: az.audits.actions.retryReport }));
    expect(mocks.api.audits.sendReport).toHaveBeenCalledWith(AUDIT_IDS.audit);
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
  });

  it('sends the report again to the addresses chosen', async () => {
    mocks.api.audits.get.mockResolvedValue(finished());
    mocks.api.audits.sendReport.mockResolvedValue(finished());
    renderScreen();
    await screen.findByRole('region', { name: 'Audit hesabatı' });
    await userEvent.click(within(report()).getByRole('button', { name: az.audits.actions.resendReport }));
    const dialog = await screen.findByRole('dialog', { name: 'Hesabatı yenidən göndər' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sil: rehber@acme.az' }));
    expect(within(dialog).getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.recipients), 'direktor@acme.az{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Göndər' }));
    expect(mocks.api.audits.sendReport).toHaveBeenCalledWith(AUDIT_IDS.audit, { emails: ['direktor@acme.az'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Sending elsewhere does not change the stored recipients (Part 1).
    expect(report()).toHaveTextContent('rehber@acme.az');
  });

  it('lets a report viewer download, but not send or retry', async () => {
    mocks.me.current = meWith(['reports.view']);
    mocks.api.audits.get.mockResolvedValue(finished());
    renderScreen();
    await screen.findByRole('region', { name: 'Audit hesabatı' });
    expect(download()).toBeEnabled();
    expect(within(report()).queryByRole('button', { name: az.audits.actions.resendReport })).not.toBeInTheDocument();
  });
});

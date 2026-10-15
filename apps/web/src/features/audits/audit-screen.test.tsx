import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meWith } from '@/features/reports/fixtures';
import i18n from '@/lib/i18n';
import { renderWithRouter } from '@/test/router';
import { AuditScreen } from './audit-screen';
import { Toaster } from '@/components/ui/sonner';
import { apiError, AUDIT_IDS, auditFixture, verdict } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { audits: { get: vi.fn(), setVerdict: vi.fn(), clearVerdict: vi.fn() }, media: { url: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const AUDITOR_PERMS = ['audits.perform', 'assignments.view'];
const LABELS = ['Problem varmı?', 'Təsvir edin', 'Temperatur', 'Ümumi görünüş', 'Video', 'Qeyd'];

const renderScreen = () => renderWithRouter(<AuditScreen id={AUDIT_IDS.audit} />, `/audits/${AUDIT_IDS.audit}`);
const items = () => screen.getByRole('navigation', { name: 'Bəndlər' });
const itemButton = (label: string) => within(items()).getByRole('button', { name: label });
const progressText = (reviewed: number, total = 6) => i18n.t('audits.progress', { reviewed, total });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(AUDITOR_PERMS);
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
  mocks.api.audits.setVerdict.mockImplementation(async (_id: string, itemId: string, body: { verdict: 'approved' | 'rejected'; comment?: string | null }) =>
    verdict(itemId, body.verdict, body.comment ?? null),
  );
});

describe('AuditScreen', () => {
  it('lists the auditable items by section with their verdicts and progress, and opens the first one', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.problem.id, 'approved'), verdict(f.temp.id, 'rejected', 'Termometr yoxlanmayıb')] }));
    renderScreen();
    expect(await screen.findByRole('heading', { level: 1, name: 'Açılış' })).toBeInTheDocument();
    expect(within(items()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(LABELS);
    expect(within(items()).getByRole('region', { name: 'Zal' })).toBeInTheDocument();
    expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'approved');
    expect(itemButton('Temperatur')).toHaveTextContent(az.audits.verdicts.rejected);
    expect(itemButton('Qeyd')).toHaveTextContent(az.audits.verdicts.unreviewed);
    expect(itemButton('Təsvir edin')).toHaveStyle({ paddingLeft: '24px' });
    expect(screen.getByText(progressText(2))).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByText(az.audits.paused)).not.toBeInTheDocument();
    // The first item is open with its answer and its problem.
    expect(itemButton('Problem varmı?')).toHaveAttribute('aria-current', 'true');
    const panel = screen.getByRole('region', { name: 'Problem varmı?' });
    expect(panel).toHaveTextContent('Bəli');
    expect(within(panel).getByText('Kritik')).toBeInTheDocument();
    expect(within(panel).getByText('Qayda üzrə')).toBeInTheDocument();
    expect(screen.getByText('Klaviatura: ↑/↓ — bənd seçimi, A — təsdiqlə, R — rədd et')).toBeInTheDocument();
  });

  it('shows the selected item with its note, problems, evidence and earlier verdict comment', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.temp.id, 'rejected', 'Termometr yoxlanmayıb')] }));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Temperatur' }));
    const temp = screen.getByRole('region', { name: 'Temperatur' });
    for (const text of ['10 °C', 'Qeyd: isti', 'Kondisioner xarabdır', 'Əl ilə qeyd', 'Adi']) expect(temp).toHaveTextContent(text);
    expect(within(temp).getByLabelText(az.audits.fields.comment)).toHaveValue('Termometr yoxlanmayıb');
    await userEvent.click(itemButton('Ümumi görünüş'));
    const photo = screen.getByRole('region', { name: 'Ümumi görünüş' });
    expect(within(photo).getAllByRole('button', { name: 'Bax: Foto' })).toHaveLength(1);
    expect(within(photo).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
  });

  it('approves with the button and moves on to the next item', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.approve }));
    expect(mocks.api.audits.setVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id, { verdict: 'approved', comment: null });
    expect(itemButton('Təsvir edin')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'approved'));
    expect(screen.getByText(progressText(1))).toBeInTheDocument();
  });

  it('asks for a comment before R rejects, then rejects with it', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.keyboard('r');
    expect(mocks.api.audits.setVerdict).not.toHaveBeenCalled();
    expect(screen.getByText(az.audits.issues.commentRequired)).toBeInTheDocument();
    const comment = screen.getByLabelText(az.audits.fields.comment);
    expect(comment).toHaveFocus();
    await userEvent.type(comment, 'Su axır, təmir lazımdır');
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.reject }));
    expect(mocks.api.audits.setVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id, { verdict: 'rejected', comment: 'Su axır, təmir lazımdır' });
    await waitFor(() => expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'rejected'));
  });

  it('moves with the arrow keys and approves with A', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(itemButton('Temperatur')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{ArrowUp}');
    expect(itemButton('Təsvir edin')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('aa');
    expect(mocks.api.audits.setVerdict.mock.calls.map(([, itemId]) => itemId)).toEqual([f.comment.id, f.temp.id]);
    expect(itemButton('Ümumi görünüş')).toHaveAttribute('aria-current', 'true');
  });

  it('ignores A and R while typing a comment', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    const comment = screen.getByLabelText(az.audits.fields.comment);
    await userEvent.type(comment, 'Ağac rəngi');
    expect(comment).toHaveValue('Ağac rəngi');
    expect(mocks.api.audits.setVerdict).not.toHaveBeenCalled();
    expect(itemButton('Problem varmı?')).toHaveAttribute('aria-current', 'true');
  });

  it('clears a verdict', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.problem.id, 'approved')] }));
    mocks.api.audits.clearVerdict.mockResolvedValue(undefined);
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.clearVerdict }));
    expect(mocks.api.audits.clearVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id);
    await waitFor(() => expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'none'));
  });

  it('shows a corrected answer and, on request, the original one with who corrected it', async () => {
    const f = auditFixture();
    const corrected = { ...f.answers, [f.temp.id]: { number: 5, note: 'isti', problem: f.answers[f.temp.id]!.problem } };
    mocks.api.audits.get.mockResolvedValue(
      f.detail({
        execution: { ...f.detail().execution, answers: corrected, corrected: true },
        corrections: {
          original: { answers: f.answers, score: null, capturedAt: '2026-11-02T08:00:00.000Z' },
          corrections: [
            {
              id: 'c1',
              itemId: f.temp.id,
              kind: 'manual',
              round: 0,
              before: { number: 10, note: 'isti' },
              after: { number: 5, note: 'isti' },
              reason: 'Termometr səhv oxunub',
              actor: { kind: 'user', name: 'Leyla Quliyeva' },
              at: '2026-11-02T08:00:00.000Z',
            },
          ],
          reworkRequests: [],
          diff: [{ itemId: f.temp.id, original: { number: 10, note: 'isti' }, current: { number: 5, note: 'isti' } }],
        },
      }),
    );
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Temperatur' }));
    const panel = screen.getByRole('region', { name: 'Temperatur' });
    expect(panel).toHaveTextContent('5 °C');
    expect(panel).toHaveTextContent('Leyla Quliyeva düzəldib · Termometr səhv oxunub');
    const toggle = within(panel).getByRole('button', { name: az.corrections.original });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(panel).toHaveTextContent('10 °C');
    expect(panel).not.toHaveTextContent('5 °C');
    // Items that were not corrected have no toggle.
    await userEvent.click(itemButton('Qeyd'));
    expect(within(screen.getByRole('region', { name: 'Qeyd' })).queryByRole('button', { name: az.corrections.original })).not.toBeInTheDocument();
  });

  it('says the audit is paused while the run is with the worker, and still takes verdicts', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ paused: true }));
    renderScreen();
    expect(await screen.findByText(az.audits.paused)).toBeInTheDocument();
    await userEvent.keyboard('a');
    expect(mocks.api.audits.setVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id, { verdict: 'approved', comment: null });
  });

  it('is read-only for a report viewer: no verdict buttons, no comment box, and A does nothing', async () => {
    const f = auditFixture();
    mocks.me.current = meWith(['reports.view']);
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.problem.id, 'rejected', 'Su axır')] }));
    renderScreen();
    const panel = await screen.findByRole('region', { name: 'Problem varmı?' });
    expect(screen.getByText('Bu audit yalnız baxış üçündür.')).toBeInTheDocument();
    expect(within(panel).getByText('Su axır')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.approve })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(az.audits.fields.comment)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'İcraya bax' })).not.toBeInTheDocument();
    await userEvent.keyboard('a{ArrowDown}');
    expect(mocks.api.audits.setVerdict).not.toHaveBeenCalled();
    expect(itemButton('Təsvir edin')).toHaveAttribute('aria-current', 'true');
  });

  it('says why a verdict on an item a correction just hid was refused, and reloads the audit', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    mocks.api.audits.setVerdict.mockRejectedValue(apiError(400, 'VALIDATION_FAILED', { fields: { itemId: 'audits.issues.notAuditable' } }));
    renderWithRouter(
      <>
        <AuditScreen id={AUDIT_IDS.audit} />
        <Toaster />
      </>,
      `/audits/${AUDIT_IDS.audit}`,
    );
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.keyboard('a');
    expect(await screen.findByText(az.audits.issues.notAuditable)).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.audits.get).toHaveBeenCalledTimes(2));
  });

  it('links to the run for schedule viewers', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    expect(await screen.findByRole('link', { name: 'İcraya bax' })).toHaveAttribute('href', '/schedule?date=2026-11-02&occurrence=o1&tab=execution');
  });
});

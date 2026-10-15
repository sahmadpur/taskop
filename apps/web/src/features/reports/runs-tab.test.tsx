import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { formatLocalDate } from '@/features/scheduling/labels';
import { renderWithRouter } from '@/test/router';
import { completedRun, IDS, meWith, page, reportRun, TODAY, VIEWER } from './fixtures';
import { RunsTab } from './runs-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { runs: vi.fn() }, occurrences: { get: vi.fn(), cancel: vi.fn() }, executions: { get: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const FILTERS = { from: TODAY, to: TODAY };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.reports.runs.mockResolvedValue(page([reportRun(), completedRun()]));
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
});

describe('RunsTab', () => {
  it('lists the runs with tenant-zone times, the people, a late sync’s server receipt, the score and the flags', async () => {
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ ...FILTERS, bucket: 'all' });
    expect(rows).toHaveLength(3);
    // Overdue and never started: both assignees, no times, no score.
    for (const text of [formatLocalDate(TODAY), '10:00', 'Açılış yoxlaması', 'Zona A1', 'Gecikib', 'Aynur Quliyeva, Kamran Əliyev']) expect(rows[1]).toHaveTextContent(text);
    // Completed offline by Aynur at 09:40 and received at 13:00: the executor only, both times, score and flags.
    for (const text of ['Tamamlanıb', 'Aynur Quliyeva', '09:40', 'Serverə çatıb:', '13:00', '87,5%', 'Telefon saatı şübhəlidir', 'Kritik: 1']) {
      expect(rows[2]).toHaveTextContent(text);
    }
    expect(rows[2]).not.toHaveTextContent('Kamran');
  });

  it('switches the bucket with the chips', async () => {
    const onBucket = vi.fn();
    renderWithRouter(<RunsTab filters={FILTERS} bucket="overdue" onBucket={onBucket} />);
    const chips = await screen.findByRole('group', { name: 'İcralar' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Gecikmiş', 'Yarımçıq', 'Buraxılmış', 'Problemli', 'Tamamlanmış', 'Davam edən', 'Planlaşdırılmış', 'Hamısı']);
    expect(within(chips).getByRole('button', { name: 'Gecikmiş' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: 'Hamısı' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(chips).getByRole('button', { name: 'Buraxılmış' }));
    expect(onBucket).toHaveBeenCalledWith('missed');
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ ...FILTERS, bucket: 'overdue' }));
  });

  it('loads the next page with the cursor and stops on the last one', async () => {
    mocks.api.reports.runs.mockResolvedValueOnce(page([reportRun()], IDS.run)).mockResolvedValueOnce(page([completedRun()]));
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(mocks.api.reports.runs).toHaveBeenLastCalledWith({ ...FILTERS, bucket: 'all', cursor: IDS.run });
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
  });

  it('opens a run in the run drawer on its overview', async () => {
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Açılış yoxlaması' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('tab', { name: 'Ümumi' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run);
  });

  it('says so when the bucket is empty', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([]));
    renderWithRouter(<RunsTab filters={FILTERS} bucket="missed" onBucket={vi.fn()} />);
    expect(await screen.findByText('Bu dövr üçün məlumat yoxdur.')).toBeInTheDocument();
  });

  it('shows each run’s audit state and marks a corrected score', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([completedRun({ auditState: 'failed', corrected: true }), reportRun()]));
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[0]!).getByRole('columnheader', { name: az.audits.audit })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(az.audits.runAuditStates.failed);
    expect(rows[1]).toHaveTextContent(`87,5%${az.corrections.corrected}`);
    expect(rows[2]).not.toHaveTextContent(az.corrections.corrected);
    expect(rows[2]).not.toHaveTextContent(az.audits.runAuditStates.failed);
  });

  it('filters by audit state', async () => {
    const onAuditState = vi.fn();
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} auditState="waiting" onAuditState={onAuditState} />);
    await screen.findAllByRole('row');
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ ...FILTERS, bucket: 'all', auditState: 'waiting' });
    const select = screen.getByRole('combobox', { name: az.audits.audit });
    expect(select).toHaveValue('waiting');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Hamısı',
      az.audits.runAuditStates.waiting,
      az.audits.runAuditStates.in_progress,
      az.audits.runAuditStates.passed,
      az.audits.runAuditStates.failed,
    ]);
    await userEvent.selectOptions(select, 'failed');
    expect(onAuditState).toHaveBeenLastCalledWith('failed');
    await userEvent.selectOptions(select, '');
    expect(onAuditState).toHaveBeenLastCalledWith(null);
  });
});

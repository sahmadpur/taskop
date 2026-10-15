import { ApiError, type ReportFile } from '@taskop/api-client';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { renderWithProviders } from '@/test/render';
import { ExportMenu } from './export-menu';
import { IDS, meWith, VIEWER } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { export: vi.fn() } },
  saveFile: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));
vi.mock('./download', () => ({ saveFile: mocks.saveFile }));

const FILTERS = { from: '2026-11-01', to: '2026-11-30', siteId: IDS.zoneA };
const FILE: ReportFile = { blob: new Blob(['x']), filename: 'taskop-runs-2026-11-01_2026-11-30.xlsx' };

function renderMenu(props: Partial<ComponentProps<typeof ExportMenu>> = {}) {
  renderWithProviders(
    <>
      <ExportMenu kind="runs" filters={FILTERS} bucket="overdue" {...props} />
      <Toaster />
    </>,
  );
}

async function choose(group: 'Bu cədvəl' | 'Tam hesabat', format: 'CSV' | 'Excel' | 'PDF') {
  await userEvent.click(screen.getByRole('button', { name: 'İxrac et' }));
  await userEvent.click(within(await screen.findByRole('group', { name: group })).getByRole('menuitem', { name: format }));
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'reports.export']);
  mocks.api.reports.export.mockResolvedValue(FILE);
});

describe('ExportMenu', () => {
  it('is not shown without reports.export', () => {
    mocks.me.current = meWith(VIEWER);
    renderMenu();
    expect(screen.queryByRole('button', { name: 'İxrac et' })).not.toBeInTheDocument();
  });

  it('offers the open table in three formats and the full report in two', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'İxrac et' }));
    expect(within(await screen.findByRole('group', { name: 'Bu cədvəl' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['CSV', 'Excel', 'PDF']);
    expect(within(screen.getByRole('group', { name: 'Tam hesabat' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Excel', 'PDF']);
  });

  it('downloads the open table with its bucket and saves it under the server’s name', async () => {
    renderMenu();
    await choose('Bu cədvəl', 'Excel');
    expect(mocks.api.reports.export).toHaveBeenCalledWith('runs', { ...FILTERS, format: 'xlsx', bucket: 'overdue' });
    expect(mocks.saveFile).toHaveBeenCalledWith(FILE);
  });

  it('sends the problems severity with the table, and neither bucket nor severity with the full report', async () => {
    renderMenu({ kind: 'problems', bucket: undefined, severity: 'critical' });
    await choose('Bu cədvəl', 'CSV');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('problems', { ...FILTERS, format: 'csv', severity: 'critical' });
    await choose('Tam hesabat', 'PDF');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('full', { ...FILTERS, format: 'pdf' });
  });

  it('shows a spinner while the file is built and starts one export at a time', async () => {
    let resolve!: (f: ReportFile) => void;
    mocks.api.reports.export.mockReturnValue(new Promise<ReportFile>((r) => (resolve = r)));
    renderMenu();
    await choose('Bu cədvəl', 'PDF');
    const busy = await screen.findByRole('button', { name: 'Fayl hazırlanır…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    // A disabled trigger opens no menu, so a second click starts nothing.
    await userEvent.click(busy);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(mocks.api.reports.export).toHaveBeenCalledOnce();
    await act(async () => resolve(FILE));
    expect(await screen.findByRole('button', { name: 'İxrac et' })).toBeEnabled();
    expect(mocks.saveFile).toHaveBeenCalledOnce();
  });

  it('says how many rows a too large export has and asks to narrow the filters', async () => {
    mocks.api.reports.export.mockRejectedValue(new ApiError(422, 'REPORT_TOO_LARGE', 'errors.REPORT_TOO_LARGE', null, null, 'r1', null, null, null, null, 12000, 10000));
    renderMenu();
    await choose('Bu cədvəl', 'CSV');
    expect(await screen.findByText('Hesabatda 12000 sətir var (limit 10000). Filtrləri daraldın.')).toBeInTheDocument();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'İxrac et' })).toBeEnabled();
  });

  it('shows other export errors from az.errors', async () => {
    mocks.api.reports.export.mockRejectedValue(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    renderMenu();
    await choose('Tam hesabat', 'Excel');
    expect(await screen.findByText('Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.')).toBeInTheDocument();
  });

  it('cannot export while the period cannot be shown', () => {
    renderMenu({ filters: null });
    expect(screen.getByRole('button', { name: 'İxrac et' })).toBeDisabled();
  });

  it('sends the audit state with the runs table only', async () => {
    renderMenu({ auditState: 'failed' });
    await choose('Bu cədvəl', 'CSV');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('runs', { ...FILTERS, format: 'csv', bucket: 'overdue', auditState: 'failed' });
    await choose('Tam hesabat', 'PDF');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('full', { ...FILTERS, format: 'pdf' });
  });
});

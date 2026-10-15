import type { AuditBrief, OccurrenceStatus } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { meWith } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AUDIT_IDS, auditDto } from './fixtures';
import { RunAuditTab } from './run-audit-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { executions: { get: vi.fn() }, audits: { start: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const brief = (over: Partial<AuditBrief> = {}): AuditBrief => ({ id: AUDIT_IDS.audit, status: 'in_progress', result: null, percent: null, paused: false, ...over });
const renderTab = (status: OccurrenceStatus = 'completed') => renderWithRouter(<RunAuditTab occurrence={occurrenceDetail({ status, execution: summary() })} />);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.current = meWith(['audits.perform']);
});

describe('RunAuditTab', () => {
  it('starts an audit on a completed run and opens it', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: null }));
    mocks.api.audits.start.mockResolvedValue(auditDto());
    const router = renderTab();
    expect(await screen.findByText(az.audits.noAudit)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.start }));
    expect(mocks.api.audits.start).toHaveBeenCalledWith('x1');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/audits/${AUDIT_IDS.audit}`));
  });

  it('offers a new audit when the last one was cancelled', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief({ status: 'cancelled' }) }));
    renderTab('audit_pending');
    expect(await screen.findByRole('button', { name: az.audits.actions.start })).toBeInTheDocument();
  });

  it('shows a running audit, paused while the run is with the worker, and links to it', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief({ paused: true }) }));
    renderTab('correction_required');
    expect(await screen.findByText(az.audits.statuses.in_progress)).toBeInTheDocument();
    expect(screen.getByText(az.audits.paused)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: az.audits.actions.open })).toHaveAttribute('href', `/audits/${AUDIT_IDS.audit}`);
    expect(screen.queryByRole('button', { name: az.audits.actions.start })).not.toBeInTheDocument();
  });

  it('shows the result of a finished audit to a report viewer, who cannot start one', async () => {
    mocks.me.current = meWith(['reports.view']);
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief({ status: 'finished', result: 'failed', percent: 83.3 }) }));
    renderTab('audited');
    expect(await screen.findByText(az.audits.results.failed)).toBeInTheDocument();
    expect(screen.getByText(`${az.audits.score}: 83,3%`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: az.audits.actions.open })).toBeInTheDocument();
  });

  it('offers no audit on a partial run, and nothing to someone without audit or report access', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ state: 'partial', audit: null }));
    renderTab('partial');
    expect(await screen.findByText(az.audits.noAudit)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.start })).not.toBeInTheDocument();
  });

  it('hides the audit link without audits.perform or reports.view', async () => {
    mocks.me.current = meWith(['assignments.view']);
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief() }));
    renderTab('audit_pending');
    expect(await screen.findByText(az.audits.statuses.in_progress)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: az.audits.actions.open })).not.toBeInTheDocument();
  });

  it('says so when the run was never started', async () => {
    renderWithRouter(<RunAuditTab occurrence={occurrenceDetail({ status: 'pending' })} />);
    expect(await screen.findByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
  });
});

import { ApiError } from '@taskop/api-client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ExecutionTab } from './execution-tab';
import { executionFixture, occurrenceDetail, summary, U2 } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { executions: { get: vi.fn() }, media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('ExecutionTab', () => {
  it('shows the executor, device times with the server receipt when it differs by over a minute, flags, score and progress', async () => {
    const f = executionFixture();
    const counted = summary({ late: true, clockSuspect: true, scorePercent: 87.5 });
    mocks.api.executions.get.mockResolvedValue(f.detail(counted));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: counted })} />);
    expect(screen.getByText('Aysel Məmmədova')).toBeInTheDocument();
    expect(screen.getByText('Tamamlanıb')).toBeInTheDocument();
    for (const flag of ['Gecikib', 'Telefon saatı şübhəlidir', '1 fayl hələ yüklənməyib']) expect(screen.getByText(flag)).toBeInTheDocument();
    // Started 08:10 Baku, received 60 s later: no receipt line. Completed 09:00, received 13:00: shown.
    expect(screen.getByText(/08:10/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Serverə çatıb:/)).toHaveLength(1);
    expect(screen.getByText(/^Serverə çatıb:/)).toHaveTextContent('13:00');
    expect(screen.getByText('87,5%')).toBeInTheDocument();
    expect(screen.getByText('5/6 cavab')).toBeInTheDocument();
    expect(await screen.findByText('android 15 · tətbiq 1.0.0 · Telefon saatı serverdən 400 san irəlidədir')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Zal' })).toBeInTheDocument();
    expect(mocks.api.executions.get).toHaveBeenCalledWith('x1');
  });

  it('shows a negative clock offset as its absolute value with the phone behind the server', async () => {
    const counted = summary({ clockSuspect: true });
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ ...counted, clockOffsetMs: -400_000 }));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: counted })} />);
    expect(await screen.findByText('android 15 · tətbiq 1.0.0 · Telefon saatı serverdən 400 san geridədir')).toBeInTheDocument();
  });

  it('says when nothing has been executed yet', () => {
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'pending' })} />);
    expect(screen.getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
    expect(mocks.api.executions.get).not.toHaveBeenCalled();
  });

  it('keeps rejected executions collapsed, and shows one without answers as having none', async () => {
    const f = executionFixture();
    const lost = summary({
      id: 'x2', executor: U2, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED',
      startedAt: '2026-11-02T04:12:00.000Z', startedReceivedAt: '2026-11-02T09:30:00.000Z', completedAt: null, completedReceivedAt: null,
      progress: { answered: 0, total: 5, requiredMissing: 4 }, scorePercent: null, problemCount: 0, mediaPending: 0,
    });
    mocks.api.executions.get.mockImplementation(async (id: string) =>
      id === 'x2' ? f.detail({ ...lost, answers: {}, answersRev: 0, media: [], problems: [], score: null }) : f.detail(),
    );
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: summary(), rejectedExecutions: [lost] })} />);
    const toggle = screen.getByRole('button', { name: 'Rədd edilmiş icralar (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Murad Əliyev')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    const item = screen.getByRole('listitem', { name: 'Murad Əliyev' });
    expect(within(item).getByText('Rədd edilib')).toBeInTheDocument();
    expect(within(item).getByText('Səbəb: Bu checklist artıq başqa əməkdaş tərəfindən icra olunur.')).toBeInTheDocument();
    expect(within(item).getByText('Tamamlanmayıb')).toBeInTheDocument();
    expect(within(item).getByText('Bal hesablanmır')).toBeInTheDocument();
    expect(within(item).getByText('4 tələb yerinə yetirilməyib')).toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Cavablara bax' }));
    expect(await within(item).findByText('Bu icrada cavab yoxdur.')).toBeInTheDocument();
    expect(mocks.api.executions.get).toHaveBeenCalledWith('x2');
    await userEvent.click(within(item).getByRole('button', { name: 'Cavabları gizlət' }));
    expect(within(item).queryByText('Bu icrada cavab yoxdur.')).not.toBeInTheDocument();
  });

  it('shows an error instead of loading forever when the execution cannot be read', async () => {
    mocks.api.executions.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText('Məlumat tapılmadı.')).toBeInTheDocument();
  });
});

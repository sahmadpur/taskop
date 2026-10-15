import { az } from '@taskop/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { renderWithProviders } from '@/test/render';
import { CorrectionsTab } from './corrections-tab';
import { correction, noCorrections, reworkRequest } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { executions: { get: vi.fn() }, corrections: { history: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('CorrectionsTab', () => {
  it('says so when the run was never corrected or sent back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail());
    mocks.api.corrections.history.mockResolvedValue(noCorrections());
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText(az.corrections.noCorrections)).toBeInTheDocument();
    expect(mocks.api.corrections.history).toHaveBeenCalledWith('x1');
  });

  it('says so when the run was never started', () => {
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ status: 'pending' })} />);
    expect(screen.getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
    expect(mocks.api.corrections.history).not.toHaveBeenCalled();
  });

  it('compares the original with the current answers and lists every change, oldest first', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(
      f.detail({
        answers: { ...f.answers, [f.temp.id]: { number: 5, note: 'isti' }, [f.note.id]: { text: 'Hamısı yoxlanıldı' } },
        score: { earned: 2, possible: 2, percent: 100, problems: [] },
        corrected: true,
      }),
    );
    mocks.api.corrections.history.mockResolvedValue({
      original: { answers: f.answers, score: { earned: 0, possible: 2, percent: 0, problems: [] }, capturedAt: '2026-11-02T09:00:00.000Z' },
      corrections: [
        correction({ id: 'c1', itemId: f.temp.id, before: { number: 10, note: 'isti' }, after: { number: 5, note: 'isti' }, reason: 'Termometr səhv oxunub' }),
        correction({
          id: 'c2',
          itemId: f.note.id,
          kind: 'rework',
          round: 1,
          after: { text: 'Hamısı yoxlanıldı' },
          reason: 'Qeyd yazın',
          actor: { kind: 'user', name: 'Aysel Məmmədova' },
          at: '2026-11-02T12:00:00.000Z',
        }),
      ],
      reworkRequests: [reworkRequest({ items: [{ itemId: f.note.id, comment: 'Qeyd yazın' }], dueAt: '2026-11-02T14:00:00.000Z', resubmittedAt: '2026-11-02T12:00:00.000Z' })],
      diff: [
        { itemId: f.temp.id, original: { number: 10, note: 'isti' }, current: { number: 5, note: 'isti' } },
        { itemId: f.note.id, original: null, current: { text: 'Hamısı yoxlanıldı' } },
      ],
    });
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText('İlkin bal: 0% · Cari bal: 100%')).toBeInTheDocument();

    const diff = screen.getByRole('table');
    const [head, temp, note] = within(diff).getAllByRole('row');
    expect(within(head!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Bənd', az.corrections.original, az.corrections.current]);
    expect(within(temp!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Temperatur', '10 °C · Qeyd: isti', '5 °C · Qeyd: isti']);
    expect(within(note!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Qeyd', 'Cavab yoxdur', 'Hamısı yoxlanıldı']);

    // The timeline's own entries, not the flagged items listed inside a send-back.
    const list = screen.getByRole('list', { name: 'Tarixçə' });
    const timeline = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(timeline.map((li) => li.dataset.kind)).toEqual(['correction', 'sentBack', 'resubmitted', 'correction']);
    expect(timeline[0]).toHaveTextContent(az.corrections.kinds.manual);
    expect(timeline[0]).toHaveTextContent('Leyla Quliyeva');
    expect(timeline[0]).toHaveTextContent('Temperatur: 10 °C · Qeyd: isti → 5 °C · Qeyd: isti');
    expect(timeline[0]).toHaveTextContent('Səbəb: Termometr səhv oxunub');
    expect(timeline[1]).toHaveTextContent('Leyla Quliyeva icranı düzəlişə qaytardı');
    expect(timeline[1]).toHaveTextContent('Qeyd — Qeyd yazın');
    expect(timeline[1]).toHaveTextContent('18:00');
    expect(timeline[2]).toHaveTextContent('İcraçı düzəlişləri təqdim etdi');
    expect(timeline[3]).toHaveTextContent(az.corrections.kinds.rework);
    expect(timeline[3]).toHaveTextContent('Şərh: Qeyd yazın');
  });

  it('names Taskop support when a platform admin sent the run back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail());
    mocks.api.corrections.history.mockResolvedValue({
      ...noCorrections(),
      reworkRequests: [reworkRequest({ requestedBy: null, items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] })],
    });
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText(/Taskop dəstəyi icranı düzəlişə qaytardı/)).toBeInTheDocument();
    expect(screen.getByText(/Raund 1/)).toBeInTheDocument();
  });

  it('names Taskop support when a platform admin withdrew the send-back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail());
    mocks.api.corrections.history.mockResolvedValue({
      ...noCorrections(),
      reworkRequests: [reworkRequest({ withdrawnAt: '2026-11-02T11:00:00.000Z', withdrawnBy: null, items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] })],
    });
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText(/Taskop dəstəyi qaytarmanı geri götürdü/)).toBeInTheDocument();
  });
});

import { formatDateTime } from '@taskop/i18n';
import { screen, within } from '@testing-library/react-native';
import i18n from '@/lib/i18n';
import { checklist } from '@/offline/testing/fixtures';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { answerSummary } from './correction-format';
import { CorrectionsTimeline } from './corrections-timeline';
import { correction, CORRECTION, CORRECTION2, executionCorrections, PHOTO, RUN_T, teamRework } from './testing/fixtures';

jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));

const tr = i18n.t.bind(i18n);
const c = checklist();
const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone: 'Asia/Baku' });
const RESUBMITTED = '2026-11-03T10:00:00.000Z';

describe('answerSummary', () => {
  it('writes an answer as one line: options, value, media and note', () => {
    expect(answerSummary(tr, c.temp, { number: 10, note: 'İsti' })).toBe('10 °C · Qeyd: İsti');
    expect(answerSummary(tr, c.problem, { optionIds: [c.yes.id], photos: [PHOTO] })).toBe('Bəli · 1 fayl');
    expect(answerSummary(tr, c.temp, null)).toBe(tr('corrections.emptyAnswer'));
    expect(answerSummary(tr, undefined, { number: 1 })).toBe(tr('corrections.emptyAnswer'));
  });
});

describe('the corrections timeline (spec §8.2, NFR-07.05)', () => {
  it('interleaves send-backs and corrections by time, each with who, when, before, after and why', async () => {
    const t = await createTestServices();
    const history = executionCorrections({
      reworkRequests: [teamRework({ items: [{ itemId: c.problem.id, comment: 'Yenidən baxın' }], resubmittedAt: RESUBMITTED })],
      corrections: [
        correction({ itemId: c.temp.id, before: { number: 10, note: 'İsti' }, after: { number: 5 } }),
        correction({
          id: CORRECTION2, itemId: c.problem.id, kind: 'rework', round: 1, before: { optionIds: [c.yes.id], photos: [PHOTO] }, after: { optionIds: [c.no.id] },
          reason: 'Yenidən baxın', actor: { kind: 'user', name: 'Aynur Quliyeva' }, at: RESUBMITTED,
        }),
      ],
    });
    await renderWithServices(t.services, <CorrectionsTimeline content={c.content} history={history} timeZone="Asia/Baku" />);
    expect(screen.getAllByTestId(/^(rework|correction)-/).map((n) => n.props.testID)).toEqual(['rework-1', `correction-${CORRECTION}`, `correction-${CORRECTION2}`]);

    const round = within(screen.getByTestId('rework-1'));
    expect(round.getByText(`${tr('corrections.round', { round: 1 })} · Leyla Məmmədova 1 bəndi qaytarıb`)).toBeTruthy();
    expect(round.getByText(tr('corrections.dueAt', { date: at('2026-11-03T14:00:00.000Z') }))).toBeTruthy();
    expect(round.getByText('Soyuducuda problem varmı?: Yenidən baxın')).toBeTruthy();
    expect(round.getByText(`Yenidən təqdim edilib: ${at(RESUBMITTED)}`)).toBeTruthy();

    const manual = within(screen.getByTestId(`correction-${CORRECTION}`));
    expect(manual.getByText('Temperatur')).toBeTruthy();
    expect(manual.getByText(`${tr('corrections.kinds.manual')} · Leyla Məmmədova, ${at(RUN_T.received)}`)).toBeTruthy();
    expect(manual.getByText('Əvvəl: 10 °C · Qeyd: İsti')).toBeTruthy();
    expect(manual.getByText('Sonra: 5 °C')).toBeTruthy();
    expect(manual.getByText('Səbəb: Termometr səhv göstərirdi')).toBeTruthy();

    const rework = within(screen.getByTestId(`correction-${CORRECTION2}`));
    expect(rework.getByText(`${tr('corrections.kinds.rework')} · ${tr('corrections.round', { round: 1 })} · Aynur Quliyeva, ${at(RESUBMITTED)}`)).toBeTruthy();
    expect(rework.getByText('Əvvəl: Bəli · 1 fayl')).toBeTruthy();
    expect(rework.getByText('Sonra: Xeyr')).toBeTruthy();
  });

  it('names a platform admin and says when nothing was corrected', async () => {
    const t = await createTestServices();
    const view = await renderWithServices(t.services, <CorrectionsTimeline content={c.content} history={executionCorrections()} timeZone="Asia/Baku" />);
    expect(screen.getByText(tr('corrections.noCorrections'))).toBeTruthy();
    await view.rerender(
      <CorrectionsTimeline
        content={c.content}
        history={executionCorrections({
          reworkRequests: [teamRework({ requestedBy: null, dueAt: null })],
          corrections: [correction({ itemId: c.temp.id, actor: { kind: 'platform', name: null } })],
        })}
        timeZone="Asia/Baku"
      />,
    );
    expect(screen.getByText(`${tr('corrections.round', { round: 1 })} · Platforma administratoru 1 bəndi qaytarıb`)).toBeTruthy();
    expect(screen.getByText(`${tr('corrections.kinds.manual')} · Platforma administratoru, ${at(RUN_T.received)}`)).toBeTruthy();
  });
});

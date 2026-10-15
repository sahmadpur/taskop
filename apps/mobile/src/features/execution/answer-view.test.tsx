import { screen, within } from '@testing-library/react-native';
import i18n from '@/lib/i18n';
import { executionDetail, executionProblem, PHOTO, PROBLEM, PROBLEM2, PROBLEM_PHOTO, RUN_T, UNREGISTERED_PHOTO } from '@/features/team/testing/fixtures';
import { checklist, type Checklist } from '@/offline/testing/fixtures';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ReadOnlyAnswers, ReadOnlyProblems } from './answer-view';

jest.mock('./capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockUrl = jest.fn(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));

async function show(c: Checklist = checklist(), over: Parameters<typeof executionDetail>[1] = {}) {
  const t = await createTestServices({ online: true });
  const d = executionDetail(c, over);
  await renderWithServices(
    t.services,
    <>
      <ReadOnlyAnswers content={d.content} answers={d.answers} media={d.media} problems={d.problems} load={mockUrl} />
      <ReadOnlyProblems content={d.content} problems={d.problems} media={d.media} load={mockUrl} />
    </>,
  );
  return c;
}

beforeEach(() => mockUrl.mockClear());

describe('read-only answers', () => {
  it('shows each section’s visible items with the answers as the worker left them', async () => {
    const c = await show();
    expect(screen.getByText('Zal')).toBeTruthy();
    expect(screen.getByText('Vitrin')).toBeTruthy();
    const problem = within(screen.getByTestId(`answer-${c.problem.id}`));
    expect(problem.getByRole('radio', { name: 'Bəli' }).props.accessibilityState).toEqual({ selected: true, disabled: true });
    expect(problem.getByRole('radio', { name: 'Xeyr' }).props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(problem.getByText('Problem qeyd olunub')).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.comment.id}`)).getByText('Kompressor səs salır')).toBeTruthy();
    const temp = within(screen.getByTestId(`answer-${c.temp.id}`));
    expect(temp.getByText('10 °C')).toBeTruthy();
    expect(temp.getByText('Qeyd: Kondisioner xarabdır')).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.photo.id}`)).getByText('Cavab verilməyib')).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.note.id}`)).getByText('Cavab verilməyib')).toBeTruthy();
  });

  it('can change nothing: no input fields, no capture or ⚑ buttons, every choice disabled', async () => {
    await show();
    expect(screen.queryByDisplayValue('Kompressor səs salır')).toBeNull();
    expect(screen.queryByDisplayValue('10')).toBeNull();
    expect(screen.queryByRole('button', { name: /Problem qeyd et/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Kamera|Qalereya/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'İndi' })).toBeNull();
    for (const radio of screen.getAllByRole('radio')) expect(radio.props.accessibilityState.disabled).toBe(true);
  });

  it('leaves out an answer to a follow-up that the final answer hides', async () => {
    const c = checklist();
    await show(c, { answers: { [c.problem.id]: { optionIds: [c.no.id] }, [c.comment.id]: { text: 'Köhnə cavab' } }, problems: [] });
    expect(screen.queryByTestId(`answer-${c.comment.id}`)).toBeNull();
    expect(screen.queryByText('Köhnə cavab')).toBeNull();
  });

  it('draws evidence through presigned URLs and marks a medium the server does not have yet', async () => {
    const c = checklist();
    await show(c, { answers: { [c.problem.id]: { optionIds: [c.yes.id], photos: [PHOTO] }, [c.photo.id]: { photos: [UNREGISTERED_PHOTO] } }, problems: [] });
    expect(await within(screen.getByTestId(`answer-${c.problem.id}`)).findByTestId(`remote-${PHOTO}`)).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.photo.id}`)).getByTestId(`pending-${UNREGISTERED_PHOTO}`)).toBeTruthy();
    expect(mockUrl).toHaveBeenCalledWith(PHOTO);
    expect(mockUrl).not.toHaveBeenCalledWith(UNREGISTERED_PHOTO);
  });

  it('lists the problems with their item, severity, source, resolution, note and media', async () => {
    await show();
    expect(screen.getByText('Problemlər')).toBeTruthy();
    const critical = within(screen.getByTestId(`problem-${PROBLEM}`));
    for (const text of ['Soyuducuda problem varmı?', 'Kritik', 'Qayda üzrə', 'Tapşırıq yoxdur']) expect(critical.getByText(text)).toBeTruthy();
    expect(await critical.findByTestId(`remote-${PHOTO}`)).toBeTruthy();
    const manual = within(screen.getByTestId(`problem-${PROBLEM2}`));
    for (const text of ['Temperatur', 'Adi', 'Əl ilə qeyd', 'Açıq', 'Termometr sınıb']) expect(manual.getByText(text)).toBeTruthy();
    expect(manual.getByTestId(`pending-${PROBLEM_PHOTO}`)).toBeTruthy();
  });

  it('says when the run has no answers, and lists no problems section without problems', async () => {
    await show(checklist(), { answers: {}, problems: [] });
    expect(screen.getByText('Bu icrada cavab yoxdur.')).toBeTruthy();
    expect(screen.queryByText('Problemlər')).toBeNull();
  });

  it('marks a problem a correction cleared, and no longer counts it as the item’s problem', async () => {
    const c = checklist();
    await show(c, { problems: [executionProblem({ id: PROBLEM, itemId: c.problem.id, mediaIds: [PHOTO], clearedAt: RUN_T.received })] });
    expect(within(screen.getByTestId(`problem-${PROBLEM}`)).getByText(i18n.t('corrections.cleared'))).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.problem.id}`)).queryByText('Problem qeyd olunub')).toBeNull();
  });
});

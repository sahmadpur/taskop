import { ApiError } from '@taskop/api-client';
import type { ExecutionDetail } from '@taskop/contracts';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@/lib/i18n';
import { checklist, ME } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { CorrectMode, correctionAnswer } from './correct-mode';
import { EXECUTION, executionDetail, PHOTO, PROBLEM_PHOTO } from './testing/fixtures';
import { renderTeam, TeamProviders } from './testing/render';
import { WithCommand } from './testing/with-command';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockCorrect = jest.fn();
jest.mock('@/lib/session', () => ({ api: { corrections: { correct: (...a: unknown[]) => mockCorrect(...a) } }, session: { refreshMe: jest.fn() } }));

const tr = i18n.t.bind(i18n);
const c = checklist();
const MANUAL = { severity: 'normal' as const, note: 'Termometr sınıb', mediaIds: [] };
/** Aynur's run, complete: "Bəli" with its photo and comment, 10 °C with a note and a manual problem, the shelf photo. */
const run = (over: Partial<ExecutionDetail> = {}) =>
  executionDetail(c, {
    answers: {
      [c.problem.id]: { optionIds: [c.yes.id], photos: [PHOTO] },
      [c.comment.id]: { text: 'Kompressor səs salır' },
      [c.temp.id]: { number: 10, note: 'Kondisioner xarabdır', problem: MANUAL },
      [c.photo.id]: { photos: [PROBLEM_PHOTO] },
    },
    ...over,
  });
const onDone = jest.fn();
const onCancel = jest.fn();
const reload = jest.fn<Promise<ExecutionDetail | undefined>, []>();
const result = { executionId: EXECUTION, answersRev: 4, changedItemIds: [c.temp.id], score: null };

const ui = (online: boolean) => (
  <WithCommand viewerId={ME}>
    {(command) => <CorrectMode detail={run()} online={online} command={command} reload={reload} onDone={onDone} onCancel={onCancel} />}
  </WithCommand>
);
async function open() {
  const t = await createTestServices({ online: true });
  return { t, view: await renderTeam(t.services, ui(true)) };
}
async function setTemperature(value: string) {
  const input = screen.getByLabelText('Temperatur');
  await fireEvent.changeText(input, value);
  await fireEvent(input, 'blur');
}
const next = () => fireEvent.press(screen.getByRole('button', { name: 'Davam et' }));
const sheet = () => within(screen.getByTestId('reason-sheet'));
async function save(reason: string) {
  await fireEvent.changeText(sheet().getByLabelText(tr('corrections.fields.reason')), reason);
  await fireEvent.press(sheet().getByRole('button', { name: tr('corrections.actions.correct') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCorrect.mockResolvedValue(result);
});

describe('correctionAnswer (Spec decision 11)', () => {
  it('keeps the values and the note, never the manual problem, and is null when nothing is left', () => {
    expect(correctionAnswer({ number: 5, note: 'İsti', problem: MANUAL })).toEqual({ number: 5, note: 'İsti' });
    expect(correctionAnswer({ optionIds: [c.no.id], photos: [PHOTO], text: '  ' })).toEqual({ optionIds: [c.no.id], photos: [PHOTO] });
    expect(correctionAnswer({ problem: MANUAL })).toBeNull();
    expect(correctionAnswer(undefined)).toBeNull();
  });
});

describe('Correct answers (spec §8.2)', () => {
  it('sends only the changed values with the reason and the revision it was based on', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    expect(screen.getByText('Foto və videolar dəyişdirilmir. Sübut səhvdirsə, icranı icraçıya qaytarın.')).toBeTruthy();
    await setTemperature('5');
    await next();
    await save('  Termometr səhv göstərirdi ');
    await eventually(async () =>
      expect(mockCorrect).toHaveBeenCalledWith(EXECUTION, {
        answersRev: 3,
        changes: [{ itemId: c.temp.id, answer: { number: 5, note: 'Kondisioner xarabdır' } }],
        reason: 'Termometr səhv göstərirdi',
      }),
    );
    expect(alert).toHaveBeenCalledWith('Düzəliş yadda saxlanıldı.');
    expect(onDone).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('says when nothing changed, and lists what a change leaves missing before asking for a reason', async () => {
    await open();
    await next();
    expect(await screen.findByText('Heç bir cavab dəyişməyib.')).toBeTruthy();
    const note = screen.getByLabelText('Qeyd: Temperatur');
    await fireEvent.changeText(note, '');
    await fireEvent(note, 'blur');
    await next();
    expect(await screen.findByText(tr('errors.REQUIREMENTS_UNMET'))).toBeTruthy();
    expect(within(screen.getByTestId(`correct-${c.temp.id}`)).getByText('Qeyd lazımdır')).toBeTruthy();
    expect(screen.queryByTestId('reason-sheet')).toBeNull();
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it('asks for a reason', async () => {
    await open();
    await setTemperature('5');
    await next();
    await save('   ');
    expect(await sheet().findByText('Səbəb yazın.')).toBeTruthy();
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it('after ANSWERS_CONFLICT it reloads and sends the next correction with the new revision', async () => {
    mockCorrect.mockRejectedValueOnce(new ApiError(409, 'ANSWERS_CONFLICT', 'errors.ANSWERS_CONFLICT')).mockResolvedValue(result);
    reload.mockResolvedValue(run({ answersRev: 4, answers: { ...run().answers, [c.temp.id]: { number: 7, note: 'Kondisioner xarabdır', problem: MANUAL } } }));
    await open();
    await setTemperature('5');
    await next();
    await save('Səhv idi');
    expect(await screen.findByText(tr('errors.ANSWERS_CONFLICT'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Davam et' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən yüklə' }));
    await eventually(async () => expect(screen.getByLabelText('Temperatur').props.value).toBe('7'));
    await setTemperature('6');
    await next();
    await save('Yenidən yoxlandı');
    await eventually(async () =>
      expect(mockCorrect).toHaveBeenLastCalledWith(EXECUTION, {
        answersRev: 4,
        changes: [{ itemId: c.temp.id, answer: { number: 6, note: 'Kondisioner xarabdır' } }],
        reason: 'Yenidən yoxlandı',
      }),
    );
    expect(mockCorrect).toHaveBeenCalledTimes(2);
  });

  it('highlights what the server says a correction leaves missing', async () => {
    mockCorrect.mockRejectedValue(Object.assign(new ApiError(422, 'REQUIREMENTS_UNMET', 'errors.REQUIREMENTS_UNMET'), { missing: [{ itemId: c.photo.id, kind: 'mediaCount' }] }));
    await open();
    await setTemperature('5');
    await next();
    await save('Səhv idi');
    expect(await within(screen.getByTestId(`correct-${c.photo.id}`)).findByText('Kifayət qədər fayl yoxdur')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each(['EXECUTION_LOCKED', 'EXECUTION_NOT_CORRECTABLE'] as const)('%s shows the message and refreshes the run', async (code) => {
    mockCorrect.mockRejectedValue(new ApiError(409, code, `errors.${code}`));
    const { view } = await open();
    const refresh = jest.spyOn(view.client, 'invalidateQueries');
    await setTemperature('5');
    await next();
    await save('Səhv idi');
    expect(await screen.findByText(tr(`errors.${code}`))).toBeTruthy();
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['team', ME] });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps the draft and turns saving off while offline', async () => {
    const { t, view } = await open();
    await setTemperature('5');
    await view.rerender(<TeamProviders services={t.services} client={view.client}>{ui(false)}</TeamProviders>);
    expect(screen.getByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.value).toBe('5');
    await next();
    await fireEvent.changeText(sheet().getByLabelText(tr('corrections.fields.reason')), 'Termometr səhv göstərirdi');
    expect(sheet().getByRole('button', { name: tr('corrections.actions.correct') }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockCorrect).not.toHaveBeenCalled();
    await view.rerender(<TeamProviders services={t.services} client={view.client}>{ui(true)}</TeamProviders>);
    await fireEvent.press(sheet().getByRole('button', { name: tr('corrections.actions.correct') }));
    await eventually(async () =>
      expect(mockCorrect).toHaveBeenCalledWith(EXECUTION, expect.objectContaining({ changes: [{ itemId: c.temp.id, answer: { number: 5, note: 'Kondisioner xarabdır' } }] })),
    );
  });
});

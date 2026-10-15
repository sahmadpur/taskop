import { ApiError } from '@taskop/api-client';
import { formatDateTime } from '@taskop/i18n';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import i18n from '@/lib/i18n';
import { ItemNotInReworkError } from '@/offline/execution-store';
import { listCommands } from '@/offline/outbox';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, OCC, REWORK_DUE, REWORK_EXECUTION, reworkSync } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { ExecutionScreen } from './execution-screen';
import { FinishOrResubmit } from './resubmit-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: jest.fn(),
  },
}));
jest.mock('./capture', () => ({
  CaptureModal: () => null,
  VideoPreview: () => null,
  pickFromGallery: jest.fn(),
}));

const tr = i18n.t.bind(i18n);
const COMMENTS = { temp: 'Temperaturu yenidən ölçün', photo: 'Şəkil bulanıqdır' };
const opacity = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).opacity;

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
});

/** OCC sent back (offline, so nothing syncs behind the test's back); Temperatur and the shelf photo flagged unless `items` says otherwise. */
async function sentBack(
  items?: (t: TestServices) => { itemId: string; comment: string }[],
): Promise<TestServices> {
  const t = await createTestServices();
  await t.seed(
    reworkSync(
      t.c,
      items
        ? items(t)
        : [
            { itemId: t.c.temp.id, comment: COMMENTS.temp },
            { itemId: t.c.photo.id, comment: COMMENTS.photo },
          ],
    ),
  );
  return t;
}
const answersOf = async (t: TestServices) => (await t.services.store.execution(REWORK_EXECUTION))!.answers;

describe('the execution screen in rework mode (spec §8.1)', () => {
  it('shows the round and the due date, the manager’s comment on each flagged item, and dims and locks the others', async () => {
    const t = await sentBack();
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    const banner = within(await screen.findByTestId('rework-banner'));
    expect(
      banner.getByText(`${tr('corrections.reworkBanner')} · ${tr('corrections.round', { round: 1 })}`),
    ).toBeTruthy();
    expect(
      banner.getByText(
        tr('corrections.dueAt', {
          date: formatDateTime(REWORK_DUE, { locale: 'az', timeZone: 'Asia/Baku' }),
        }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(`Rəhbərin şərhi: ${COMMENTS.temp}`)).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.editable).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Problem qeyd et: Temperatur' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });
    expect(screen.getByRole('radio', { name: 'Xeyr' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(
      screen.getByRole('button', { name: 'Problem qeyd et: Soyuducuda problem varmı?' }).props
        .accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(opacity(`wrap-${t.c.problem.id}`)).toBe(0.5);
    expect(opacity(`wrap-${t.c.temp.id}`)).toBeUndefined();
    expect(screen.getByText('2/2 qaytarılan bənd hazırdır')).toBeTruthy();
  });

  it('saves a flagged item, follows the progress, and ends on "Yenidən təqdim et"', async () => {
    const t = await sentBack();
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    const input = await screen.findByLabelText('Temperatur');
    await fireEvent.changeText(input, '10');
    await fireEvent(input, 'blur');
    await eventually(async () => expect((await answersOf(t))[t.c.temp.id]).toEqual({ number: 10 }));
    expect(await screen.findByText('1/2 qaytarılan bənd hazırdır')).toBeTruthy(); // 10 °C now asks for a note
    await fireEvent.press(screen.getByRole('button', { name: 'Növbəti bölmə' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yenidən təqdim et' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]/finish', params: { id: OCC } });
  });

  it('shows a follow-up a flagged change reveals as a new question the worker can answer', async () => {
    const t = await sentBack((s) => [{ itemId: s.c.problem.id, comment: 'Yenidən baxın' }]);
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Bəli' }));
    const followUp = await screen.findByTestId(`wrap-${t.c.comment.id}`);
    expect(within(followUp).getByText('Yeni sual')).toBeTruthy();
    expect(within(followUp).queryByText(/^Rəhbərin şərhi/)).toBeNull();
    expect(screen.getByLabelText('Problemi təsvir edin').props.editable).toBe(true);
    expect(opacity(`wrap-${t.c.comment.id}`)).toBeUndefined();
    expect(screen.getByText('0/2 qaytarılan bənd hazırdır')).toBeTruthy(); // the photo "Bəli" asks for, and the new question
  });

  it('says so when the store refuses an item that was not sent back', async () => {
    const t = await sentBack();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest
      .spyOn(t.services.store, 'patchAnswer')
      .mockRejectedValueOnce(new ItemNotInReworkError([t.c.temp.id]));
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    const input = await screen.findByLabelText('Temperatur');
    await fireEvent.changeText(input, '6');
    await fireEvent(input, 'blur');
    await eventually(async () =>
      expect(alert).toHaveBeenCalledWith('Bu bənd düzəlişə qaytarılmayıb, onu dəyişmək olmaz.'),
    );
    alert.mockRestore();
  });

  it('is read-only once resubmitted here', async () => {
    const t = await sentBack();
    await t.services.store.resubmit(REWORK_EXECUTION);
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    expect(await screen.findByText('Düzəlişlər göndərilib. Cavablar artıq dəyişdirilə bilməz.')).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.editable).toBe(false);
    expect(screen.queryByTestId('rework-banner')).toBeNull();
  });
});

describe('the Resubmit screen (spec §8.1)', () => {
  it('lists the flagged items with what is missing, keeps resubmitting off until they are fixed, and jumps to an item', async () => {
    const t = await sentBack();
    await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.temp.id, { number: 10 });
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    const temp = within(await screen.findByTestId(`rework-item-${t.c.temp.id}`));
    expect(temp.getByText(`Rəhbərin şərhi: ${COMMENTS.temp}`)).toBeTruthy();
    expect(temp.getByText('Qeyd lazımdır')).toBeTruthy();
    expect(within(screen.getByTestId(`rework-item-${t.c.photo.id}`)).getByText('Hazırdır')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByTestId(`rework-item-${t.c.temp.id}`));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/execution/[id]',
      params: expect.objectContaining({ id: OCC, itemId: t.c.temp.id }),
    });
    await act(async () => {
      await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.temp.id, { note: 'İsti idi' });
    });
    await eventually(async () =>
      expect(
        screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState,
      ).toMatchObject({ disabled: false }),
    );
  });

  it('resubmits once, says so and goes home; the screen is then read-only', async () => {
    const t = await sentBack();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    const button = await screen.findByRole('button', { name: 'Yenidən təqdim et' });
    await fireEvent.press(button);
    await fireEvent.press(button);
    await eventually(async () =>
      expect(await t.services.store.execution(REWORK_EXECUTION)).toMatchObject({ state: 'completed' }),
    );
    expect(alert).toHaveBeenCalledWith('Düzəlişlər göndərildi.');
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect((await listCommands(t.db)).filter((c) => c.kind === 'resubmit')).toHaveLength(1);
    expect(await screen.findByText('Düzəlişlər göndərilib. Cavablar artıq dəyişdirilə bilməz.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    alert.mockRestore();
  });

  it('answers a required follow-up that a flagged change reveals, and resubmits', async () => {
    const t = await sentBack((s) => [{ itemId: s.c.problem.id, comment: 'Yenidən baxın' }]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.problem.id, { optionIds: [t.c.yes.id] });
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    const followUp = () => within(screen.getByTestId(`rework-item-${t.c.comment.id}`));
    await screen.findByTestId(`rework-item-${t.c.comment.id}`);
    expect(followUp().getByText('Yeni sual')).toBeTruthy();
    expect(followUp().getByText('Cavab verilməyib')).toBeTruthy();
    expect(
      within(screen.getByTestId(`rework-item-${t.c.problem.id}`)).getByText('Foto lazımdır'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => {
      await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.comment.id, { text: 'Kompressor səs salır' });
      await t.services.store.attachMedia(REWORK_EXECUTION, capturedPhoto(t.transport), {
        itemId: t.c.problem.id,
        field: 'evidence',
      });
    });
    await eventually(async () => expect(followUp().getByText('Hazırdır')).toBeTruthy());
    await eventually(async () =>
      expect(
        screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState,
      ).toMatchObject({ disabled: false }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən təqdim et' }));
    await eventually(async () =>
      expect(await t.services.store.execution(REWORK_EXECUTION)).toMatchObject({ state: 'completed' }),
    );
    expect(alert).toHaveBeenCalledWith('Düzəlişlər göndərildi.');
    expect((await listCommands(t.db)).filter((c) => c.kind === 'resubmit')).toHaveLength(1);
    alert.mockRestore();
  });

  it('after the server refuses a resubmit for unmet requirements, the reopened run lists what is missing locally, with no note', async () => {
    const t = await sentBack();
    const refuse = async (): Promise<never> => {
      throw new ApiError(422, 'REQUIREMENTS_UNMET' as never, 'errors.REQUIREMENTS_UNMET');
    };
    // The first cycle's pull fails, so the screen sees what the refused push left.
    t.api.on('pull', async (): Promise<never> => {
      throw new ApiError(503, 'INTERNAL' as never, 'errors.INTERNAL');
    });
    t.api.on('resubmit', refuse);
    expect(await t.services.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
    t.net.online = true;
    await t.services.engine.run('manual');
    t.services.engine.stop();
    t.net.online = false;
    expect(await t.services.store.execution(REWORK_EXECUTION)).toMatchObject({
      state: 'rework',
      syncNote: null,
    });
    // The server still disagrees with what the phone holds: the temperature is out of range and asks for a note.
    await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.temp.id, { number: 10 });
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    expect(
      within(await screen.findByTestId(`rework-item-${t.c.temp.id}`)).getByText('Qeyd lazımdır'),
    ).toBeTruthy();
    expect(within(screen.getByTestId(`rework-item-${t.c.photo.id}`)).getByText('Hazırdır')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('shows the normal finish screen for a run that was never sent back', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    expect(await screen.findByRole('button', { name: 'Tamamla' })).toBeTruthy();
    expect(screen.queryByText('Qaytarılan bəndlər')).toBeNull();
  });
});

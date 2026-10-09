import { MEDIA_LIMITS } from '@taskop/contracts';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, myExecution, OCC, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION2, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { ExecutionScreen } from './execution-screen';
import { readOnlyReason } from './use-execution';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('./capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));

type Opened = TestServices & { id: string };

async function opened(focusItemId?: (t: TestServices) => string): Promise<Opened> {
  const t = await createTestServices();
  await t.seed();
  const id = await t.services.store.start(OCC, ME);
  // The route param is the occurrence id (Task 12 navigates by occurrence).
  await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} focusItemId={focusItemId?.(t)} />);
  await screen.findByText(focusItemId ? 'Vitrin' : 'Zal');
  return { ...t, id };
}
const answers = async (t: Opened, id = t.id) => (await t.services.store.execution(id))!.answers;

describe('ExecutionScreen', () => {
  it('shows one section at a time with progress, and follow-ups appear inline', async () => {
    const t = await opened();
    expect(screen.getByText('Bölmə 1/2')).toBeTruthy();
    expect(screen.getByText('0/4 cavablandı')).toBeTruthy();
    expect(screen.queryByText('Problemi təsvir edin')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Bəli' }));
    expect(await screen.findByText('Problemi təsvir edin')).toBeTruthy();
    expect(screen.getByText('1/5 cavablandı')).toBeTruthy();
    expect(screen.getByText('Foto lazımdır')).toBeTruthy();
    expect(await answers(t)).toEqual({ [t.c.problem.id]: { optionIds: [t.c.yes.id] } });
    await fireEvent.press(screen.getByRole('button', { name: 'Növbəti bölmə' }));
    expect(await screen.findByText('Vitrin')).toBeTruthy();
    expect(screen.getByText('Bölmə 2/2')).toBeTruthy();
  });

  it('saves a number on blur and then asks for the note its rule requires', async () => {
    const t = await opened();
    const input = screen.getByLabelText('Temperatur');
    await fireEvent.changeText(input, '10');
    await fireEvent(input, 'blur');
    const note = await screen.findByLabelText('Qeyd: Temperatur');
    expect(await answers(t)).toEqual({ [t.c.temp.id]: { number: 10 } });
    expect(screen.getByText('Problem qeyd olunub')).toBeTruthy();
    await fireEvent.changeText(note, 'Kondisioner xarabdır');
    await fireEvent(note, 'blur');
    await eventually(async () => expect((await answers(t))[t.c.temp.id]).toEqual({ number: 10, note: 'Kondisioner xarabdır' }));
  });

  it('offers only the camera on live-only items and attaches gallery photos elsewhere', async () => {
    const t = await opened();
    const problemCard = screen.getByTestId(`item-${t.c.problem.id}`);
    expect(within(problemCard).getByRole('button', { name: 'Foto: Kamera' })).toBeTruthy();
    const { pickFromGallery } = jest.requireMock('./capture') as { pickFromGallery: jest.Mock };
    pickFromGallery.mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(within(problemCard).getByRole('button', { name: 'Foto: Qalereya' }));
    await eventually(async () => expect((await answers(t))[t.c.problem.id]?.photos).toHaveLength(1));
    expect(pickFromGallery).toHaveBeenCalledWith('photo');

    await fireEvent.press(screen.getByRole('button', { name: 'Növbəti bölmə' }));
    const photoCard = await screen.findByTestId(`item-${t.c.photo.id}`);
    expect(within(photoCard).getByRole('button', { name: 'Foto: Kamera' })).toBeTruthy();
    expect(within(photoCard).queryByRole('button', { name: 'Foto: Qalereya' })).toBeNull();
    expect(within(photoCard).getByText('Yalnız kamera')).toBeTruthy();
  });

  it('flags a manual problem with a severity and a required note', async () => {
    const t = await opened();
    await fireEvent.press(screen.getByRole('button', { name: 'Problem qeyd et: Temperatur' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('Təsvir yazın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Kritik' }));
    await fireEvent.changeText(screen.getByLabelText('Təsvir'), 'Termometr sınıb');
    await fireEvent.press(screen.getByRole('button', { name: 'Yadda saxla' }));
    await eventually(async () =>
      expect((await answers(t))[t.c.temp.id]).toEqual({ problem: { severity: 'critical', note: 'Termometr sınıb', mediaIds: [] } }),
    );
    expect(await screen.findByText('Problem qeyd olunub')).toBeTruthy();
  });

  it('stops adding problem media at the limit, and cancelling the sheet discards the unsaved media', async () => {
    const t = await opened();
    const { pickFromGallery } = jest.requireMock('./capture') as { pickFromGallery: jest.Mock };
    pickFromGallery.mockImplementation(async () => capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Problem qeyd et: Temperatur' }));
    const sheet = await screen.findByTestId('problem-sheet');
    for (let n = 1; n <= MEDIA_LIMITS.problemMaxMedia; n++) {
      await fireEvent.press(within(sheet).getByRole('button', { name: 'Foto: Qalereya' }));
      expect(await within(sheet).findByRole('button', { name: `Foto ${n}` })).toBeTruthy();
    }
    expect(within(sheet).getByRole('button', { name: 'Foto: Qalereya' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(within(sheet).getByRole('button', { name: 'Video: Kamera' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(await t.services.store.media(t.id)).toHaveLength(MEDIA_LIMITS.problemMaxMedia);
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Ləğv et' }));
    await eventually(async () => expect(await t.services.store.media(t.id)).toEqual([]));
    expect(screen.queryByTestId('problem-sheet')).toBeNull();
  });

  it('locks the execution when the device clock reaches closes_at', async () => {
    const t = await opened();
    await act(async () => {
      t.clock.set(T.closes);
      t.services.feed.emit();
    });
    expect(await screen.findByText('İcra vaxtı bitib — cavablar yarımçıq kimi saxlanıldı.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bəli' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('shows who won the claim on a rejected execution', async () => {
    const t = await opened();
    await act(async () => {
      await t.db.run(`UPDATE executions SET state = 'rejected', claim = 'rejected', rejected_reason = 'ALREADY_CLAIMED', rejected_by = 'Murad Həsənov'`);
      t.services.feed.emit();
    });
    expect(await screen.findByText('Bu checklist artıq Murad Həsənov tərəfindən icra olunur')).toBeTruthy();
  });

  it('is read-only once a pull shows someone else holding the claim', async () => {
    const t = await opened();
    await act(async () => {
      await t.db.run('UPDATE occurrences SET claim_execution_id = ?, claim_user_id = ?, claim_name = ?', [OTHER_EXECUTION, OTHER, 'Murad Həsənov']);
      t.services.feed.emit();
    });
    expect(await screen.findByText('Bu checklist artıq Murad Həsənov tərəfindən icra olunur')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bəli' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('keeps working after the sync engine moves the execution to another id', async () => {
    const t = await opened();
    await fireEvent.press(screen.getByRole('radio', { name: 'Bəli' }));
    await eventually(async () => expect(await answers(t)).toEqual({ [t.c.problem.id]: { optionIds: [t.c.yes.id] } }));
    // What adopting my other install's claim does (sync-engine adoptExecution).
    await act(async () => {
      await t.db.run(`UPDATE executions SET id = ?, claim = 'accepted' WHERE id = ?`, [OTHER_EXECUTION, t.id]);
      await t.db.run('UPDATE outbox SET execution_id = ? WHERE execution_id = ?', [OTHER_EXECUTION, t.id]);
      await t.db.run('UPDATE occurrences SET claim_execution_id = ?, claim_user_id = ?, claim_name = ?', [OTHER_EXECUTION, ME, 'Aysel Əliyeva']);
      t.services.feed.emit();
    });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Xeyr' }));
    await eventually(async () => expect(await answers(t, OTHER_EXECUTION)).toEqual({ [t.c.problem.id]: { optionIds: [t.c.no.id] } }));
    expect(await t.services.store.execution(t.id)).toBeNull();
  });

  it('asks to update the app for a checklist schema newer than it understands', async () => {
    const t = await createTestServices();
    await t.seed(
      syncResponse({
        occurrences: [occurrence({ checklistVersionId: VERSION2 })],
        checklistVersions: [versionOf({ schemaVersion: 2 }, VERSION2, 2)],
        executions: [myExecution({ checklistVersionId: VERSION2 })],
      }),
    );
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    expect(await screen.findByText('Tətbiqi yeniləyin')).toBeTruthy();
  });

  it('opens the section of the item the finish screen jumped to', async () => {
    await opened((t) => t.c.photo.id);
    expect(screen.getByText('Bölmə 2/2')).toBeTruthy();
  });
});

describe('readOnlyReason', () => {
  it('locks rejected, claimed-by-someone-else, completed, partial and closed executions', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    const e = (await t.services.store.execution(id))!;
    const o = (await t.services.store.occurrence(OCC))!;
    const now = Date.parse(T.open);
    expect(readOnlyReason(e, o, ME, now)).toBeNull();
    expect(readOnlyReason(e, { ...o, claim: { executionId: OTHER_EXECUTION, executorUserId: ME, executorName: 'Aysel Əliyeva' } }, ME, now)).toBeNull();
    expect(readOnlyReason(e, o, ME, Date.parse(T.closes))).toBe('locked');
    expect(readOnlyReason({ ...e, state: 'partial' }, o, ME, now)).toBe('locked');
    expect(readOnlyReason({ ...e, state: 'completed' }, o, ME, now)).toBe('completed');
    expect(readOnlyReason({ ...e, state: 'rejected' }, o, ME, now)).toBe('rejected');
    expect(readOnlyReason(e, { ...o, claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' } }, ME, now)).toBe('claimedByOther');
  });
});

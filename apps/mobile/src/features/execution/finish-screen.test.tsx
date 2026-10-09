import { fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { ExecutionLockedError } from '@/offline/execution-store';
import { createTestServices } from '@/offline/testing/test-services';
import { FinishScreen } from './finish-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() } }));

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
});

async function started() {
  const t = await createTestServices();
  await t.seed();
  const id = await t.services.store.start(OCC, ME);
  return { t, id };
}

async function answerEverything(t: Awaited<ReturnType<typeof started>>['t'], id: string) {
  await t.services.store.patchAnswer(id, t.c.problem.id, { optionIds: [t.c.no.id] });
  await t.services.store.patchAnswer(id, t.c.temp.id, { number: 10, note: 'isti' });
  await t.services.store.attachMedia(id, capturedPhoto(t.transport), { itemId: t.c.photo.id, field: 'evidence' });
}

describe('FinishScreen', () => {
  it('lists what is missing, keeps "Tamamla" disabled, and jumps to the item with a fresh focus value each time', async () => {
    const { t } = await started();
    await renderWithServices(t.services, <FinishScreen occurrenceId={OCC} />);
    const row = await screen.findByRole('button', { name: 'Soyuducuda problem varmı?: Cavab verilməyib' });
    expect(screen.getByRole('button', { name: 'Temperatur: Cavab verilməyib' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vitrinin şəkli: Cavab verilməyib' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(row);
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledTimes(2);
    type Jump = { pathname: string; params: { id: string; itemId: string; focus: string } };
    const first = mockPush.mock.calls[0]![0] as Jump;
    const second = mockPush.mock.calls[1]![0] as Jump;
    expect(first).toMatchObject({ pathname: '/execution/[id]', params: { id: OCC, itemId: t.c.problem.id } });
    expect(first.params.focus).toBeTruthy();
    expect(second.params.focus).not.toBe(first.params.focus);
  });

  it('previews the score and problems, then completes', async () => {
    const { t, id } = await started();
    await answerEverything(t, id);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <FinishScreen occurrenceId={OCC} />);
    expect(await screen.findByText('Bütün tələblər yerinə yetirilib.')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Problemlər: 1')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    await eventually(async () => expect(await t.services.store.execution(id)).toMatchObject({ state: 'completed' }));
    expect(alert).toHaveBeenCalledWith('Checklist tamamlandı.');
    expect(mockReplace).toHaveBeenCalledWith('/');
    alert.mockRestore();
  });

  it('keeps "Tamamla" disabled once the execution is read-only', async () => {
    const { t, id } = await started();
    await answerEverything(t, id);
    await t.services.store.complete(id);
    await renderWithServices(t.services, <FinishScreen occurrenceId={OCC} />);
    await screen.findByText('Bütün tələblər yerinə yetirilib.');
    expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('shows the missing list the store reports when it refuses completion', async () => {
    const { t, id } = await started();
    await answerEverything(t, id);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(t.services.store, 'complete').mockResolvedValueOnce({ ok: false, missing: [{ itemId: t.c.temp.id, kind: 'answer' }] });
    await renderWithServices(t.services, <FinishScreen occurrenceId={OCC} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Tamamla' }));
    expect(await screen.findByRole('button', { name: 'Temperatur: Cavab verilməyib' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(alert).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('says the execution is locked when the store refuses completion because the window closed', async () => {
    const { t, id } = await started();
    await answerEverything(t, id);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(t.services.store, 'complete').mockRejectedValueOnce(new ExecutionLockedError('partial'));
    await renderWithServices(t.services, <FinishScreen occurrenceId={OCC} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Tamamla' }));
    await eventually(async () => expect(alert).toHaveBeenCalledWith('İcra vaxtı bitib — cavablar yarımçıq kimi saxlanıldı.'));
    expect(mockReplace).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

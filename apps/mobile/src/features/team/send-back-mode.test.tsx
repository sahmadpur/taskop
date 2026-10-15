import { ApiError } from '@taskop/api-client';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@/lib/i18n';
import { toAnswerDatetime } from '@/features/execution/datetime-format';
import { checklist, ME } from '@/offline/testing/fixtures';
import { createTestServices } from '@/offline/testing/test-services';
import { SendBackMode } from './send-back-mode';
import { EXECUTION, executionDetail, teamRework } from './testing/fixtures';
import { gate, renderTeam } from './testing/render';
import { WithCommand } from './testing/with-command';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockSendBack = jest.fn();
jest.mock('@/lib/session', () => ({ api: { corrections: { sendBack: (...a: unknown[]) => mockSendBack(...a) } }, session: { refreshMe: jest.fn() } }));

const tr = i18n.t.bind(i18n);
const c = checklist();
const onDone = jest.fn();
const onCancel = jest.fn();
/** Lets the send finish inside act, so the command's last state update is not a stray one. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const sendButton = () => screen.getByRole('button', { name: tr('corrections.actions.sendBack') });

async function open(online = true) {
  const t = await createTestServices({ online });
  return renderTeam(
    t.services,
    <WithCommand viewerId={ME}>{(command) => <SendBackMode detail={executionDetail(c)} online={online} command={command} onDone={onDone} onCancel={onCancel} />}</WithCommand>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendBack.mockResolvedValue(teamRework());
});

describe('Send back (spec §8.2)', () => {
  it('sends the picked items with their comments and the due date', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    expect(screen.getByRole('checkbox', { name: 'Problemi təsvir edin' })).toBeTruthy(); // a visible follow-up can be sent back too
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), '  Yenidən ölçün ');
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD), istəyə görə'), '2026-11-03 18:00');
    await fireEvent.press(sendButton());
    await flush();
    expect(mockSendBack).toHaveBeenCalledWith(EXECUTION, {
      items: [{ itemId: c.temp.id, comment: 'Yenidən ölçün' }],
      dueAt: toAnswerDatetime('datetime', '2026-11-03 18:00'),
    });
    expect(alert).toHaveBeenCalledWith('İcra icraçıya qaytarıldı.');
    expect(onDone).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('asks for at least one item, a comment for each, and a valid date', async () => {
    await open();
    await fireEvent.press(sendButton());
    expect(await screen.findByText('Ən azı bir bənd seçin.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.press(sendButton());
    expect(await screen.findByText('Hər seçilmiş bənd üçün şərh yazın.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD), istəyə görə'), 'sabah');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('Format düzgün deyil.')).toBeTruthy();
    expect(mockSendBack).not.toHaveBeenCalled();
  });

  it('shows the server’s due-date refusal under the field', async () => {
    mockSendBack.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { dueAt: 'corrections.issues.dueInPast' }));
    await open();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD), istəyə görə'), '2020-01-01 10:00');
    await fireEvent.press(sendButton());
    await flush();
    expect(await screen.findByText(tr('corrections.issues.dueInPast'))).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each(['EXECUTION_NOT_CORRECTABLE', 'EXECUTION_LOCKED'] as const)('%s shows the message and refreshes the run', async (code) => {
    mockSendBack.mockRejectedValue(new ApiError(409, code, `errors.${code}`));
    const view = await open();
    const refresh = jest.spyOn(view.client, 'invalidateQueries');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.press(sendButton());
    await flush();
    expect(await screen.findByText(tr(`errors.${code}`))).toBeTruthy();
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['team', ME] });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('an item the server no longer knows is explained and the run refreshed', async () => {
    mockSendBack.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { 'items.0.itemId': 'executions.issues.unknownItem' }));
    const view = await open();
    const refresh = jest.spyOn(view.client, 'invalidateQueries');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.press(sendButton());
    await flush();
    expect(await screen.findByText(tr('executions.issues.unknownItem'))).toBeTruthy();
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['team', ME] });
  });

  it('a second tap while sending sends once', async () => {
    const g = gate();
    mockSendBack.mockImplementation(async () => {
      await g.opened;
      return teamRework();
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.press(sendButton());
    await fireEvent.press(sendButton());
    await act(async () => g.open());
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockSendBack).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('offline the send button is off and the hint shows, and the picks stay', async () => {
    await open(false);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    expect(screen.getByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(sendButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('checkbox', { name: 'Temperatur' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('button', { name: tr('common.cancel') }));
    expect(onCancel).toHaveBeenCalled();
  });
});

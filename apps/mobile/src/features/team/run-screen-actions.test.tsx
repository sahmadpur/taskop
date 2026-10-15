import { ApiError } from '@taskop/api-client';
import type { PermissionKey } from '@taskop/contracts';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@/lib/i18n';
import { checklist, OCC } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TeamRunScreen } from './run-screen';
import {
  AUDIT,
  AUDIT2,
  auditBrief,
  auditDetail,
  correction,
  CORRECTION,
  EXECUTION,
  executionCorrections,
  executionDetail,
  executionSummary,
  LEYLA,
  occurrenceDetail,
  RUN_T,
  teamMe,
  teamRework,
} from './testing/fixtures';
import { renderTeam } from './testing/render';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
let mockMe = teamMe();
const mockOccurrence = jest.fn();
const mockExecution = jest.fn();
const mockUrl = jest.fn();
const mockStart = jest.fn();
const mockAudit = jest.fn();
const mockHistory = jest.fn();
const mockWithdraw = jest.fn();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: jest.fn(async () => undefined) },
  api: {
    occurrences: { get: (...a: unknown[]) => mockOccurrence(...a) },
    executions: { get: (...a: unknown[]) => mockExecution(...a) },
    media: { url: (...a: unknown[]) => mockUrl(...a) },
    audits: { start: (...a: unknown[]) => mockStart(...a), get: (...a: unknown[]) => mockAudit(...a) },
    corrections: { history: (...a: unknown[]) => mockHistory(...a), withdraw: (...a: unknown[]) => mockWithdraw(...a) },
  },
}));

const tr = i18n.t.bind(i18n);
const c = checklist();
const BOTH: PermissionKey[] = ['reports.view', 'audits.perform', 'executions.correct'];
const OFFLINE = 'Komandanı görmək üçün internetə qoşulun';
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));

async function open(permissions?: PermissionKey[]) {
  mockMe = teamMe(permissions ? { permissions } : {});
  const t = await createTestServices({ online: true });
  await renderTeam(t.services, <TeamRunScreen occurrenceId={OCC} />);
  return t;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));
  mockOccurrence.mockResolvedValue(occurrenceDetail());
  mockExecution.mockResolvedValue(executionDetail(c));
});

describe('Team run screen actions (spec §8.2)', () => {
  it('offers Audit, Correct and Send back on a completed run to a holder of both keys', async () => {
    await open(BOTH);
    const bar = within(await screen.findByTestId('run-actions'));
    for (const name of [tr('audits.actions.start'), tr('corrections.actions.correct'), tr('corrections.actions.sendBack')]) expect(bar.getByRole('button', { name })).toBeTruthy();
    expect(bar.queryByRole('button', { name: tr('corrections.actions.withdraw') })).toBeNull();
    await settle();
    expect(mockHistory).not.toHaveBeenCalled(); // never corrected nor sent back (Spec decision 14)
  });

  it('offers nothing to a viewer with neither key', async () => {
    await open();
    expect(await screen.findByLabelText('İcraçı: Aynur Quliyeva')).toBeTruthy();
    await settle();
    expect(screen.queryByTestId('run-actions')).toBeNull();
  });

  it('starts an audit and opens it; when one exists already it opens that one instead', async () => {
    mockStart.mockResolvedValueOnce(auditDetail(c)).mockRejectedValueOnce(Object.assign(new ApiError(409, 'AUDIT_EXISTS', 'errors.AUDIT_EXISTS'), { auditId: AUDIT2 }));
    mockAudit.mockImplementation(async (id: string) => auditDetail(c, { id }));
    await open(['reports.view', 'audits.perform']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.start') }));
    expect(await screen.findByText(tr('audits.progress', { reviewed: 0, total: 5 }))).toBeTruthy();
    expect(mockStart).toHaveBeenCalledWith(EXECUTION);
    expect(mockAudit).toHaveBeenCalledWith(AUDIT);
    await fireEvent.press(screen.getByRole('button', { name: tr('common.close') }));
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.start') }));
    await eventually(async () => expect(mockAudit).toHaveBeenCalledWith(AUDIT2));
    expect(screen.queryByText(tr('errors.AUDIT_EXISTS'))).toBeNull();
  });

  it('opens Send back, and Cancel returns to the run', async () => {
    await open(['reports.view', 'executions.correct']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('corrections.actions.sendBack') }));
    expect(await screen.findByText('Düzəldilməli bəndləri seçin və hər biri üçün şərh yazın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: tr('common.cancel') }));
    expect(await screen.findByTestId('run-actions')).toBeTruthy();
  });

  it('keeps an open correction and its draft when the connection drops', async () => {
    const t = await open(['reports.view', 'executions.correct']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('corrections.actions.correct') }));
    const input = await screen.findByLabelText('Temperatur');
    await fireEvent.changeText(input, '5');
    await fireEvent(input, 'blur');
    await act(async () => {
      t.net.online = false;
      await t.services.engine.refresh();
    });
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.value).toBe('5');
    await act(async () => {
      t.net.online = true;
      await t.services.engine.refresh();
    });
    expect(screen.queryByText(OFFLINE)).toBeNull();
    expect(screen.getByLabelText('Temperatur').props.value).toBe('5');
  });

  it('shows the open request of a run sent back, its round in the timeline, and withdraws it after confirming', async () => {
    const request = teamRework({ items: [{ itemId: c.temp.id, comment: 'Yenidən ölçün' }] });
    mockOccurrence.mockResolvedValue(occurrenceDetail({ status: 'correction_required', execution: executionSummary({ state: 'rework' }) }));
    mockExecution.mockResolvedValue(executionDetail(c, { state: 'rework', reworkRound: 1, rework: request }));
    mockHistory.mockResolvedValue(executionCorrections({ reworkRequests: [request] }));
    mockWithdraw.mockResolvedValue(teamRework({ withdrawnAt: RUN_T.received, withdrawnBy: LEYLA }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open(BOTH);
    const rework = within(await screen.findByTestId('run-rework'));
    expect(rework.getByText(`${tr('corrections.reworkBanner')} · ${tr('corrections.round', { round: 1 })}`)).toBeTruthy();
    expect(rework.getByText('Temperatur: Yenidən ölçün')).toBeTruthy();
    expect(await screen.findByTestId('rework-1')).toBeTruthy();
    const bar = within(screen.getByTestId('run-actions'));
    expect(bar.queryByRole('button', { name: tr('corrections.actions.correct') })).toBeNull();
    const before = mockOccurrence.mock.calls.length;
    await fireEvent.press(bar.getByRole('button', { name: tr('corrections.actions.withdraw') }));
    expect(alert.mock.calls[0]![0]).toBe('Qaytarma geri götürülsün?');
    await act(async () => {
      alert.mock.calls[0]![2]![1]!.onPress!();
    });
    await eventually(async () => expect(mockWithdraw).toHaveBeenCalledWith(EXECUTION));
    await eventually(async () => expect(alert).toHaveBeenCalledWith('Qaytarma geri götürüldü.'));
    expect(mockOccurrence.mock.calls.length).toBeGreaterThan(before); // the run was refreshed
    alert.mockRestore();
  });

  it('shows the audit result and the corrected marker, and the corrections of a corrected run', async () => {
    mockOccurrence.mockResolvedValue(occurrenceDetail({ status: 'audited' }));
    mockExecution.mockResolvedValue(executionDetail(c, { corrected: true, audit: auditBrief({ status: 'finished', result: 'failed', percent: 60 }) }));
    mockHistory.mockResolvedValue(executionCorrections({ corrections: [correction({ itemId: c.temp.id })] }));
    await open();
    expect(await screen.findByText(`${tr('audits.audit')}: ${tr('audits.runAuditStates.failed')} · 60%`)).toBeTruthy();
    expect(screen.getByText(tr('corrections.corrected'))).toBeTruthy();
    expect(await screen.findByTestId(`correction-${CORRECTION}`)).toBeTruthy();
    expect(mockHistory).toHaveBeenCalledWith(EXECUTION);
  });

  it('keeps the refusal visible when the run moved on and the open mode is no longer allowed', async () => {
    // Send back is refused (the run was audited meanwhile); the refresh shows an audited run, which cannot be sent back.
    mockStart.mockRejectedValue(new Error('unused'));
    const refused = new ApiError(409, 'EXECUTION_NOT_CORRECTABLE', 'errors.EXECUTION_NOT_CORRECTABLE');
    const sendBack = jest.fn().mockRejectedValue(refused);
    (jest.requireMock('@/lib/session') as { api: { corrections: Record<string, unknown> } }).api.corrections.sendBack = sendBack;
    await open(['reports.view', 'executions.correct']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('corrections.actions.sendBack') }));
    await fireEvent.press(await screen.findByRole('checkbox', { name: c.temp.label }));
    await fireEvent.changeText(await screen.findByLabelText(`${tr('corrections.fields.itemComment')}: ${c.temp.label}`), 'Yenidən ölçün');
    mockOccurrence.mockResolvedValue(occurrenceDetail({ status: 'audited' }));
    mockExecution.mockResolvedValue(executionDetail(c, { audit: auditBrief({ status: 'finished', result: 'passed', percent: 100 }) }));
    await fireEvent.press(screen.getByRole('button', { name: tr('corrections.actions.sendBack') }));
    // The refusal refreshes the run; an audited run cannot be sent back, so the screen returns to the run view.
    await eventually(async () => expect(screen.queryByText('Düzəldilməli bəndləri seçin və hər biri üçün şərh yazın.')).toBeNull());
    expect(await screen.findByText(`${tr('audits.audit')}: ${tr('audits.runAuditStates.passed')} · 100%`)).toBeTruthy();
    expect(screen.getByText(tr('errors.EXECUTION_NOT_CORRECTABLE'))).toBeTruthy(); // the reason stays on the run view
    expect(screen.getAllByText(tr('errors.EXECUTION_NOT_CORRECTABLE'))).toHaveLength(1);
  });
});

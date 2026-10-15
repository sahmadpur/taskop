import { ApiError } from '@taskop/api-client';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import i18n from '@/lib/i18n';
import { colors } from '@/lib/theme';
import { checklist, ME } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { AuditPanel } from './audit-panel';
import { parseEmails } from './finish-audit-sheet';
import { AUDIT, auditDetail, auditVerdict, RUN_T } from './testing/fixtures';
import { renderTeam, TeamProviders } from './testing/render';
import { WithCommand } from './testing/with-command';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockGet = jest.fn();
const mockSetVerdict = jest.fn();
const mockClearVerdict = jest.fn();
const mockFinish = jest.fn();
const mockUrl = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    audits: {
      get: (...a: unknown[]) => mockGet(...a),
      setVerdict: (...a: unknown[]) => mockSetVerdict(...a),
      clearVerdict: (...a: unknown[]) => mockClearVerdict(...a),
      finish: (...a: unknown[]) => mockFinish(...a),
    },
    media: { url: (...a: unknown[]) => mockUrl(...a) },
  },
  session: { refreshMe: jest.fn() },
}));

const tr = i18n.t.bind(i18n);
const c = checklist();
const ALL = [c.problem.id, c.comment.id, c.temp.id, c.photo.id, c.note.id];
const allApproved = () => ALL.map((id) => auditVerdict(id));
const onClose = jest.fn();
const ui = (online: boolean) => (
  <WithCommand viewerId={ME}>{(command) => <AuditPanel viewerId={ME} auditId={AUDIT} online={online} command={command} onClose={onClose} />}</WithCommand>
);
async function open() {
  const t = await createTestServices({ online: true });
  return { t, view: await renderTeam(t.services, ui(true)) };
}
const card = (itemId: string) => within(screen.getByTestId(`audit-item-${itemId}`));
const finishButton = () => screen.getByRole('button', { name: tr('audits.actions.finish') });
const border = (itemId: string) => StyleSheet.flatten(screen.getByTestId(`audit-item-${itemId}`).props.style).borderColor;

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));
});

describe('parseEmails', () => {
  it('splits on commas, semicolons and spaces', () => {
    expect(parseEmails(' a@b.az, c@d.az;e@f.az  g@h.az ')).toEqual(['a@b.az', 'c@d.az', 'e@f.az', 'g@h.az']);
    expect(parseEmails('   ')).toEqual([]);
  });
});

describe('Audit (spec §8.2, FR-19.02–06)', () => {
  it('approves in one tap, rejects with a required comment, and counts the progress without reloading the audit', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    mockSetVerdict.mockImplementation(async (_id: string, itemId: string, body: { verdict: 'approved' | 'rejected'; comment?: string }) =>
      auditVerdict(itemId, { verdict: body.verdict, comment: body.comment ?? null }),
    );
    await open();
    expect(await screen.findByText(tr('audits.progress', { reviewed: 0, total: 5 }))).toBeTruthy();
    expect(card(c.problem.id).getByText(tr('audits.verdicts.unreviewed'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: `${tr('audits.actions.approve')}: Soyuducuda problem varmı?` }));
    expect(await card(c.problem.id).findByText(tr('audits.verdicts.approved'))).toBeTruthy();
    expect(mockSetVerdict).toHaveBeenCalledWith(AUDIT, c.problem.id, { verdict: 'approved' });
    expect(screen.getByText(tr('audits.progress', { reviewed: 1, total: 5 }))).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }));
    const sheet = within(screen.getByTestId('verdict-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await sheet.findByText(tr('audits.issues.commentRequired'))).toBeTruthy();
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), '  Termometr yoxlanmayıb ');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    await eventually(async () => expect(screen.queryByTestId('verdict-sheet')).toBeNull());
    expect(mockSetVerdict).toHaveBeenLastCalledWith(AUDIT, c.temp.id, { verdict: 'rejected', comment: 'Termometr yoxlanmayıb' });
    expect(card(c.temp.id).getByText(tr('audits.verdicts.rejected'))).toBeTruthy();
    expect(card(c.temp.id).getByText('Termometr yoxlanmayıb')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('clears a verdict', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: [auditVerdict(c.temp.id, { verdict: 'rejected', comment: 'Yoxlanmayıb' })] }));
    mockClearVerdict.mockResolvedValue(undefined);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: `${tr('audits.actions.clearVerdict')}: Temperatur` }));
    expect(await card(c.temp.id).findByText(tr('audits.verdicts.unreviewed'))).toBeTruthy();
    expect(mockClearVerdict).toHaveBeenCalledWith(AUDIT, c.temp.id);
  });

  it('finishes when every item has a verdict, with the result, a comment and extra addresses, then shows the result', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const finished = auditDetail(c, {
      status: 'finished', result: 'failed', score: { approved: 5, rejected: 0, reviewed: 5, percent: 100 }, comment: 'İki bənd uyğun deyil',
      finishedAt: RUN_T.received, reportStatus: 'pending', verdicts: allApproved(),
    });
    mockGet.mockResolvedValueOnce(auditDetail(c, { verdicts: allApproved() })).mockResolvedValue(finished);
    mockFinish.mockResolvedValue(finished);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    expect(sheet.getByText('Hesabat göndəriləcək: audit@demo.taskop.az')).toBeTruthy();
    await fireEvent.press(sheet.getByRole('radio', { name: tr('audits.results.failed') }));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'İki bənd uyğun deyil');
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), 'Boss@Demo.az, qa@demo.az;boss@demo.az');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    await eventually(async () =>
      expect(mockFinish).toHaveBeenCalledWith(AUDIT, { result: 'failed', comment: 'İki bənd uyğun deyil', extraEmails: ['boss@demo.az', 'qa@demo.az'] }),
    );
    expect(alert).toHaveBeenCalledWith('Audit bitdi.');
    const result = within(await screen.findByTestId('audit-result'));
    expect(result.getByText(tr('audits.results.failed'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${tr('audits.actions.approve')}: Temperatur` })).toBeNull();
    alert.mockRestore();
  });

  it('refuses an invalid extra address in the sheet', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), 'boss@demo');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await sheet.findByText('E-poçt ünvanlarından biri düzgün deyil.')).toBeTruthy();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it('keeps Finish off while an item has no verdict', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved().slice(0, 4) }));
    await open();
    expect(await screen.findByText(tr('audits.progress', { reviewed: 4, total: 5 }))).toBeTruthy();
    expect(finishButton().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('highlights the items AUDIT_INCOMPLETE names', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    mockFinish.mockRejectedValue(Object.assign(new ApiError(422, 'AUDIT_INCOMPLETE', 'errors.AUDIT_INCOMPLETE'), { itemIds: [c.note.id] }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    await fireEvent.press(within(screen.getByTestId('finish-sheet')).getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await screen.findByText(tr('errors.AUDIT_INCOMPLETE'))).toBeTruthy();
    expect(border(c.note.id)).toBe(colors.warning);
    expect(border(c.temp.id)).toBe(colors.border);
  });

  it('a paused audit says the run was sent back, still takes verdicts, and cannot finish', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { paused: true, verdicts: allApproved() }));
    await open();
    expect(within(await screen.findByTestId('audit-paused')).getByText(tr('audits.paused'))).toBeTruthy();
    expect(finishButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('shows a finished audit read-only with its result, score and report status', async () => {
    mockGet.mockResolvedValue(
      auditDetail(c, { status: 'finished', result: 'passed', score: { approved: 5, rejected: 0, reviewed: 5, percent: 100 }, finishedAt: RUN_T.received, reportStatus: 'ready', verdicts: allApproved() }),
    );
    await open();
    const result = within(await screen.findByTestId('audit-result'));
    expect(result.getByText(tr('audits.results.passed'))).toBeTruthy();
    expect(result.getByText('100%')).toBeTruthy();
    expect(result.getByText(`${tr('audits.reportStatuses.ready')} · PDF hesabatı veb-də yükləmək olar.`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: tr('audits.actions.finish') })).toBeNull();
    expect(screen.queryByRole('button', { name: `${tr('audits.actions.approve')}: Temperatur` })).toBeNull();
  });

  it('offline the review stays on screen; verdicts and Finish are off with the hint', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    const { t, view } = await open();
    expect(await screen.findByText(tr('audits.progress', { reviewed: 5, total: 5 }))).toBeTruthy();
    await view.rerender(<TeamProviders services={t.services} client={view.client}>{ui(false)}</TeamProviders>);
    expect(screen.getByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(screen.getByText(tr('audits.progress', { reviewed: 5, total: 5 }))).toBeTruthy();
    expect(finishButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: `${tr('audits.actions.approve')}: Temperatur` }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('a hidden item is refused: the message shows, the sheet closes and the audit reloads', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    mockSetVerdict.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { itemId: 'audits.issues.notAuditable' }),
    );
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }));
    const sheet = within(screen.getByTestId('verdict-sheet'));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'Yoxlanmayıb');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await screen.findByText(tr('audits.issues.notAuditable'))).toBeTruthy();
    expect(screen.queryByTestId('verdict-sheet')).toBeNull();
    await eventually(async () => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('the server refusing a rejection without a comment shows in the sheet', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    mockSetVerdict.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { comment: 'audits.issues.commentRequired' }),
    );
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }));
    const sheet = within(screen.getByTestId('verdict-sheet'));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'Yoxlanmayıb');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await sheet.findByText(tr('audits.issues.commentRequired'))).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('finish refused while the run was sent back: the message shows and the audit reloads paused', async () => {
    mockGet.mockResolvedValueOnce(auditDetail(c, { verdicts: allApproved() })).mockResolvedValue(auditDetail(c, { paused: true, verdicts: allApproved() }));
    mockFinish.mockRejectedValue(new ApiError(409, 'AUDIT_PAUSED', 'errors.AUDIT_PAUSED'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    await fireEvent.press(within(screen.getByTestId('finish-sheet')).getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await screen.findByText(tr('errors.AUDIT_PAUSED'), { exact: false })).toBeTruthy();
    expect(await screen.findByTestId('audit-paused')).toBeTruthy();
  });

  it('finish while media is still uploading keeps the sheet open with what was typed, shows the message and does not reload', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    mockFinish.mockRejectedValue(new ApiError(422, 'MEDIA_NOT_FOUND_IN_STORAGE', 'errors.MEDIA_NOT_FOUND_IN_STORAGE'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    await fireEvent.press(sheet.getByRole('radio', { name: tr('audits.results.failed') }));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'İki bənd uyğun deyil');
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), 'boss@demo.az');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await sheet.findByText(tr('errors.MEDIA_NOT_FOUND_IN_STORAGE'))).toBeTruthy();
    expect(screen.getByTestId('finish-sheet')).toBeTruthy();
    expect(sheet.getByLabelText(tr('audits.fields.comment')).props.value).toBe('İki bənd uyğun deyil');
    expect(sheet.getByLabelText(tr('audits.fields.extraEmails')).props.value).toBe('boss@demo.az');
    expect(sheet.getByRole('radio', { name: tr('audits.results.failed') }).props.accessibilityState).toMatchObject({ selected: true });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('refuses a merged list over 20: the checklist address plus 20 extras', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    const twenty = Array.from({ length: 20 }, (_, i) => `u${i}@demo.az`).join(', ');
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), twenty);
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await sheet.findByText(tr('audits.issues.tooManyEmails'))).toBeTruthy();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it('accepts 20 extras when one repeats the checklist address (the merge de-duplicates)', async () => {
    const finished = auditDetail(c, { status: 'finished', result: 'passed', reportStatus: 'pending', verdicts: allApproved() });
    mockGet.mockResolvedValueOnce(auditDetail(c, { verdicts: allApproved() })).mockResolvedValue(finished);
    mockFinish.mockResolvedValue(finished);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    const list = ['AUDIT@demo.taskop.az', ...Array.from({ length: 19 }, (_, i) => `u${i}@demo.az`)].join(' ');
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), list);
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    await eventually(async () => expect(mockFinish).toHaveBeenCalledTimes(1));
    alert.mockRestore();
  });

  it('a stale refusal of a verdict (the audit ended) closes the reject sheet, shows the message and reloads', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    mockSetVerdict.mockRejectedValue(new ApiError(409, 'AUDIT_NOT_IN_PROGRESS', 'errors.AUDIT_NOT_IN_PROGRESS'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }));
    const sheet = within(screen.getByTestId('verdict-sheet'));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'Yoxlanmayıb');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await screen.findByText(tr('errors.AUDIT_NOT_IN_PROGRESS'))).toBeTruthy();
    expect(screen.queryByTestId('verdict-sheet')).toBeNull();
    await eventually(async () => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('a reject sheet error is cleared when the sheet is edited, closed or reopened', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    mockSetVerdict.mockRejectedValue(new ApiError(0, 'NETWORK', 'errors.NETWORK'));
    await open();
    const reject = () => screen.getByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` });
    await fireEvent.press(await screen.findByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }));
    let sheet = within(screen.getByTestId('verdict-sheet'));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'Yoxlanmayıb');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await sheet.findByText(tr('errors.NETWORK'))).toBeTruthy();
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'Yoxlanmayıb!');
    expect(sheet.queryByText(tr('errors.NETWORK'))).toBeNull();
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await sheet.findByText(tr('errors.NETWORK'))).toBeTruthy();
    await fireEvent.press(sheet.getByRole('button', { name: tr('common.cancel') }));
    await fireEvent.press(reject());
    sheet = within(screen.getByTestId('verdict-sheet'));
    expect(sheet.queryByText(tr('errors.NETWORK'))).toBeNull();
    expect(screen.queryByText(tr('errors.NETWORK'))).toBeNull();
  });

  it('AUDIT_INCOMPLETE reloads the audit and the named item says it is unreviewed', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    mockFinish.mockRejectedValue(Object.assign(new ApiError(422, 'AUDIT_INCOMPLETE', 'errors.AUDIT_INCOMPLETE'), { itemIds: [c.note.id] }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    await fireEvent.press(within(screen.getByTestId('finish-sheet')).getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await screen.findByText(tr('errors.AUDIT_INCOMPLETE'))).toBeTruthy();
    expect(screen.queryByTestId('finish-sheet')).toBeNull();
    await eventually(async () => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(card(c.note.id).getByLabelText(`${tr('audits.verdicts.unreviewed')}: ${tr('errors.AUDIT_INCOMPLETE')}`)).toBeTruthy();
    expect(card(c.temp.id).queryByLabelText(`${tr('audits.verdicts.unreviewed')}: ${tr('errors.AUDIT_INCOMPLETE')}`)).toBeNull();
  });

  it('offline with the audit not yet loaded says to connect, not a bare spinner', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    const t = await createTestServices({ online: true });
    await renderTeam(t.services, ui(false));
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

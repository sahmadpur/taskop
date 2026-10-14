import { ApiError } from '@taskop/api-client';
import { formatDateTime } from '@taskop/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { CHECKLIST, OCC, OCC2, OCC3, T } from '@/offline/testing/fixtures';
import { createTestServices } from '@/offline/testing/test-services';
import { TeamScreen } from './team-screen';
import { counts, employeeRow, KAMRAN, reportRun, reportSummary, runPage, teamMe, unassignedRow, VIEWER2, WORKER_A, WORKER_B } from './testing/fixtures';
import { gate, renderTeam, TeamProviders } from './testing/render';

const mockPush = jest.fn();
// useFocusEffect is a no-op here; Task 5's team-list.test.tsx drives focus.
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) }, useFocusEffect: () => undefined }));
const mockSummary = jest.fn();
const mockEmployees = jest.fn();
const mockRuns = jest.fn();
const mockRefreshMe = jest.fn();
let mockMe = teamMe();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: () => mockRefreshMe() },
  api: {
    reports: {
      summary: (...a: unknown[]) => mockSummary(...a),
      employees: (...a: unknown[]) => mockEmployees(...a),
      runs: (...a: unknown[]) => mockRuns(...a),
    },
  },
}));

const DAY = { from: '2026-11-02', to: '2026-11-02' };
const TIMEOUT_TEXT = 'Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.';
// Inside act: the list's own batching timer (50 ms) may fire while we wait.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

/** Online by default; the clock at 08:10 on Monday 2 Nov in Baku unless `at` says otherwise. */
const world = (o: { online?: boolean; at?: string } = {}) => createTestServices({ online: o.online ?? true, at: o.at });

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = teamMe();
  mockSummary.mockResolvedValue(reportSummary({ counts: counts({ planned: 12, due: 10, completed: 7, overdue: 2, partial: 1, withProblems: 3 }), completionPercent: 70 }));
  mockEmployees.mockResolvedValue([employeeRow(), employeeRow({ userId: WORKER_B, name: KAMRAN.fullName, active: false }), unassignedRow()]);
  mockRuns.mockResolvedValue(runPage([reportRun()]));
  mockRefreshMe.mockResolvedValue(undefined);
});

describe('Team screen', () => {
  it('shows today’s six tiles and asks for every run of the tenant’s day', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    for (const label of ['Tamamlanıb: 7', 'Tamamlanmayıb: 3', 'Gecikib: 2', 'Yarımçıq: 1', 'Problemli: 3', 'Tamamlanma faizi: 70%']) {
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
    expect(mockSummary).toHaveBeenCalledWith(DAY);
    expect(mockEmployees).toHaveBeenCalledWith(DAY);
    expect(mockRuns).toHaveBeenCalledWith({ ...DAY, bucket: 'all' });
    expect(screen.getByRole('radio', { name: 'Bu gün' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('radio', { name: 'Hamısı' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('switches the period to 7 and 30 days, and writes — for an empty period', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await screen.findByLabelText('Tamamlanıb: 7');
    await fireEvent.press(screen.getByRole('radio', { name: '7 gün' }));
    await waitFor(async () => expect(mockSummary).toHaveBeenLastCalledWith({ from: '2026-10-27', to: '2026-11-02' }));
    expect(mockRuns).toHaveBeenLastCalledWith({ from: '2026-10-27', to: '2026-11-02', bucket: 'all' });
    expect(mockEmployees).toHaveBeenLastCalledWith({ from: '2026-10-27', to: '2026-11-02' });
    mockSummary.mockResolvedValue(reportSummary());
    await fireEvent.press(screen.getByRole('radio', { name: '30 gün' }));
    expect(await screen.findByLabelText('Tamamlanma faizi: —')).toBeTruthy();
    expect(screen.getByLabelText('Tamamlanmayıb: 0')).toBeTruthy();
    expect(mockSummary).toHaveBeenLastCalledWith({ from: '2026-10-04', to: '2026-11-02' });
  });

  it('counts "Bu gün" on the tenant’s calendar, not the phone’s', async () => {
    mockMe = teamMe({ timezone: 'Pacific/Auckland' });
    const t = await world({ at: '2026-11-02T12:00:00.000Z' }); // 01:00 on 3 Nov in Auckland, still 2 Nov almost everywhere else
    await renderTeam(t.services, <TeamScreen />);
    await waitFor(async () => expect(mockSummary).toHaveBeenCalledWith({ from: '2026-11-03', to: '2026-11-03' }));
    expect(mockRuns).toHaveBeenCalledWith({ from: '2026-11-03', to: '2026-11-03', bucket: 'all' });
    await screen.findByLabelText('Tamamlanıb: 7'); // let react-query publish its result before the test ends
  });

  it('moves to the new day at the tenant’s midnight while the screen stays open', async () => {
    const t = await world({ at: '2026-11-02T19:59:00.000Z' }); // 23:59 in Baku
    await renderTeam(t.services, <TeamScreen />);
    await waitFor(async () => expect(mockSummary).toHaveBeenLastCalledWith(DAY));
    t.clock.set('2026-11-02T20:01:00.000Z'); // 00:01 on 3 Nov in Baku
    await act(async () => t.services.feed.emit());
    await waitFor(async () => expect(mockSummary).toHaveBeenLastCalledWith({ from: '2026-11-03', to: '2026-11-03' }));
    expect(mockRuns).toHaveBeenLastCalledWith({ from: '2026-11-03', to: '2026-11-03', bucket: 'all' });
    await screen.findByLabelText('Tamamlanıb: 7');
  });

  it('maps each status chip to its runs bucket and keeps the tiles', async () => {
    mockRuns.mockImplementation(async (q: { bucket: string }) => runPage([reportRun({ checklist: { id: CHECKLIST, name: `Yoxlama ${q.bucket}` } })]));
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText('Yoxlama all')).toBeTruthy();
    for (const [chip, bucket] of [['Gecikmiş', 'overdue'], ['Yarımçıq', 'partial'], ['Buraxılmış', 'missed'], ['Problemli', 'problems']] as const) {
      await fireEvent.press(screen.getByRole('radio', { name: chip }));
      expect(await screen.findByText(`Yoxlama ${bucket}`)).toBeTruthy();
      expect(mockRuns).toHaveBeenLastCalledWith({ ...DAY, bucket });
    }
    // Back to Hamısı within 30 s: the page from the start is still fresh, so it is shown without asking again.
    await fireEvent.press(screen.getByRole('radio', { name: 'Hamısı' }));
    expect(await screen.findByText('Yoxlama all')).toBeTruthy();
    expect(mockRuns).toHaveBeenCalledTimes(5);
    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Tamamlanıb: 7')).toBeTruthy();
  });

  it('filters by an employee of the period, never offering the Unassigned row', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Əməkdaş: Bütün əməkdaşlar' }));
    expect(screen.getByRole('radio', { name: 'Aynur Quliyeva' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Kamran Əliyev (Deaktiv)' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Təyin edilməyib' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Aynur Quliyeva' }));
    await waitFor(async () => expect(mockRuns).toHaveBeenLastCalledWith({ ...DAY, userId: WORKER_A, bucket: 'all' }));
    expect(mockSummary).toHaveBeenLastCalledWith({ ...DAY, userId: WORKER_A });
    expect(mockEmployees).toHaveBeenCalledTimes(1); // the picker's list is the period's, not the person's
    await fireEvent.press(screen.getByRole('button', { name: 'Əməkdaş: Aynur Quliyeva' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Bütün əməkdaşlar' }));
    expect(await screen.findByRole('button', { name: 'Əməkdaş: Bütün əməkdaşlar' })).toBeTruthy();
    expect(mockSummary).toHaveBeenCalledTimes(2); // everyone's tiles are still fresh
  });

  it('keeps the chosen employee when the period changes and shows the empty state', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Əməkdaş: Bütün əməkdaşlar' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Aynur Quliyeva' }));
    // Aynur has nothing in the last 30 days.
    mockEmployees.mockResolvedValue([employeeRow({ userId: WORKER_B, name: KAMRAN.fullName })]);
    mockRuns.mockResolvedValue(runPage([]));
    await fireEvent.press(screen.getByRole('radio', { name: '30 gün' }));
    await waitFor(async () => expect(mockRuns).toHaveBeenLastCalledWith({ from: '2026-10-04', to: '2026-11-02', userId: WORKER_A, bucket: 'all' }));
    expect(await screen.findByText('Bu dövr üçün məlumat yoxdur.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Əməkdaş: Aynur Quliyeva' })).toBeTruthy();
  });

  it('shows each run with checklist, site, person, due time, status and problems, and opens it', async () => {
    mockRuns.mockResolvedValue(
      runPage([
        reportRun({ clockSuspect: true }),
        reportRun({ occurrenceId: OCC2, executionId: null, status: 'missed', executor: null, startedAt: null, completedAt: null, completedReceivedAt: null, score: null, problemCount: 0, criticalCount: 0 }),
        reportRun({ occurrenceId: OCC3, executionId: null, status: 'overdue', assignees: [], executor: null, startedAt: null, completedAt: null, completedReceivedAt: null, score: null, problemCount: 0, criticalCount: 0 }),
      ]),
    );
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    const due = `Son vaxt: ${formatDateTime(T.due, { locale: 'az', timeZone: 'Asia/Baku' })}`;
    const done = within(await screen.findByTestId(`run-${OCC}`));
    for (const text of ['Açılış yoxlaması', 'Bakı filialı 1', 'Aynur Quliyeva', due, 'Tamamlanıb', 'Problem: 2', 'Kritik: 1', 'Telefon saatı şübhəlidir']) {
      expect(done.getByText(text)).toBeTruthy();
    }
    const missed = within(screen.getByTestId(`run-${OCC2}`));
    expect(missed.getByText('Aynur Quliyeva, Kamran Əliyev')).toBeTruthy();
    expect(missed.getByText('Buraxılıb')).toBeTruthy();
    expect(missed.queryByText(/^Problem:/)).toBeNull();
    const unassigned = within(screen.getByTestId(`run-${OCC3}`));
    expect(unassigned.getByText('Təyin edilməyib')).toBeTruthy();
    expect(unassigned.getByText('Gecikib')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`run-${OCC}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team/run/[id]', params: { id: OCC } });
  });

  it('offline it asks for a connection, requests nothing, and loads once back online', async () => {
    const t = await world({ online: false });
    const sync = jest.spyOn(t.services, 'syncNow').mockResolvedValue(undefined);
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(sync).toHaveBeenCalledWith('manual');
    await settle();
    expect(mockSummary).not.toHaveBeenCalled();
    expect(mockEmployees).not.toHaveBeenCalled();
    expect(mockRuns).not.toHaveBeenCalled();
    t.net.online = true;
    await act(async () => t.services.engine.refresh());
    expect(await screen.findByLabelText('Tamamlanıb: 7')).toBeTruthy();
    expect(screen.queryByText('Komandanı görmək üçün internetə qoşulun')).toBeNull();
  });

  it('hides the team data it had when the phone goes offline', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await screen.findByLabelText('Tamamlanıb: 7');
    t.net.online = false;
    await act(async () => t.services.engine.refresh());
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(screen.queryByLabelText('Tamamlanıb: 7')).toBeNull();
    expect(screen.queryByTestId(`run-${OCC}`)).toBeNull();
  });

  it('shows a report timeout with a retry and does not retry by itself', async () => {
    mockSummary.mockRejectedValueOnce(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText(TIMEOUT_TEXT)).toBeTruthy();
    await settle();
    expect(mockSummary).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByLabelText('Tamamlanıb: 7')).toBeTruthy();
    expect(screen.queryByText(TIMEOUT_TEXT)).toBeNull();
    expect(mockSummary).toHaveBeenCalledTimes(2);
    expect(mockRuns).toHaveBeenCalledTimes(1); // only what failed is asked again
  });

  it('refreshes the profile once when the server says 403', async () => {
    const no = () => new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN');
    mockSummary.mockImplementation(async () => Promise.reject(no()));
    mockEmployees.mockImplementation(async () => Promise.reject(no()));
    mockRuns.mockImplementation(async () => Promise.reject(no()));
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText('Bu əməliyyat üçün icazəniz yoxdur.')).toBeTruthy();
    await settle();
    expect(mockRefreshMe).toHaveBeenCalledTimes(1);
  });

  it('never shows the previous manager’s numbers to the next one', async () => {
    const t = await world();
    const view = await renderTeam(t.services, <TeamScreen />);
    await screen.findByLabelText('Tamamlanıb: 7');
    const next = gate();
    mockSummary.mockImplementation(async () => {
      await next.opened;
      return reportSummary({ counts: counts({ due: 1, completed: 1 }), completionPercent: 100 });
    });
    mockMe = teamMe({ id: VIEWER2 });
    await view.rerender(
      <TeamProviders services={t.services} client={view.client}>
        <TeamScreen />
      </TeamProviders>,
    );
    await waitFor(async () => expect(mockSummary).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Tamamlanıb: 7')).toBeNull();
    await act(async () => next.open());
    expect(await screen.findByLabelText('Tamamlanıb: 1')).toBeTruthy();
  });
});

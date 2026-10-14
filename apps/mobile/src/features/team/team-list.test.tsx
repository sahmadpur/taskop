import { ApiError } from '@taskop/api-client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import { CHECKLIST, OCC, OCC2, OCC3, OCC4 } from '@/offline/testing/fixtures';
import { createTestServices } from '@/offline/testing/test-services';
import { TEAM_STALE_MS } from './queries';
import { TeamScreen } from './team-screen';
import { counts, employeeRow, reportRun, reportSummary, RUN_CURSOR, runPage, teamMe } from './testing/fixtures';
import { gate, renderTeam } from './testing/render';

const mockFocus = { set: (_focused: boolean) => undefined as void };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  // The screen is focused while rendered, until mockFocus.set(false) blurs it.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const react = jest.requireActual<typeof import('react')>('react');
    const [focused, setFocused] = react.useState(true);
    mockFocus.set = setFocused;
    react.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));
const mockSummary = jest.fn();
const mockEmployees = jest.fn();
const mockRuns = jest.fn();
const mockMe = teamMe();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: jest.fn(async () => undefined) },
  api: {
    reports: {
      summary: (...a: unknown[]) => mockSummary(...a),
      employees: (...a: unknown[]) => mockEmployees(...a),
      runs: (...a: unknown[]) => mockRuns(...a),
    },
  },
}));

const run = (occurrenceId: string, name = 'Açılış yoxlaması') => reportRun({ occurrenceId, checklist: { id: CHECKLIST, name } });
const rowIds = () => screen.queryAllByTestId(/^run-/).map((e) => (e.props.testID as string).slice('run-'.length));
const cursorCalls = () => mockRuns.mock.calls.filter(([q]) => (q as { cursor?: string }).cursor).length;
// Inside act: the list's own batching timer (50 ms) may fire while we wait.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

async function opened() {
  const t = await createTestServices({ online: true });
  await renderTeam(t.services, <TeamScreen />);
  await screen.findByTestId(`run-${OCC}`);
  return t;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus.set = () => undefined;
  mockSummary.mockResolvedValue(reportSummary({ counts: counts({ due: 3, completed: 1 }), completionPercent: 33.3 }));
  mockEmployees.mockResolvedValue([employeeRow()]);
  mockRuns.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? runPage([run(OCC3)]) : runPage([run(OCC), run(OCC2)], RUN_CURSOR)));
});
afterEach(() => jest.restoreAllMocks());

describe('Team run list', () => {
  it('loads the next page at the end of the list and stops at the last page', async () => {
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    expect(await screen.findByTestId(`run-${OCC3}`)).toBeTruthy();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await settle();
    expect(mockRuns.mock.calls.map(([q]) => (q as { cursor?: string }).cursor ?? null)).toEqual([null, RUN_CURSOR]);
    expect(rowIds()).toEqual([OCC, OCC2, OCC3]);
  });

  it('asks for a page once when the end is reached twice while it loads', async () => {
    const next = gate();
    mockRuns.mockImplementation(async (q: { cursor?: string }) => {
      if (!q.cursor) return runPage([run(OCC), run(OCC2)], RUN_CURSOR);
      await next.opened;
      return runPage([run(OCC3)]);
    });
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    expect(cursorCalls()).toBe(1);
    await act(async () => next.open());
    expect(await screen.findByTestId(`run-${OCC3}`)).toBeTruthy();
    expect(cursorCalls()).toBe(1);
  });

  it('pull to refresh reloads tiles, people and runs, and drops a next page that was loading', async () => {
    const next = gate();
    let first = [run(OCC), run(OCC2)];
    mockRuns.mockImplementation(async (q: { cursor?: string }) => {
      if (!q.cursor) return runPage(first, RUN_CURSOR);
      await next.opened;
      return runPage([run(OCC3, 'Köhnə səhifə')]);
    });
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await waitFor(async () => expect(cursorCalls()).toBe(1));
    first = [run(OCC4), run(OCC)];
    await fireEvent(screen.getByTestId('team-runs'), 'refresh');
    await waitFor(async () => expect(rowIds()).toEqual([OCC4, OCC]));
    expect(mockSummary).toHaveBeenCalledTimes(2);
    expect(mockEmployees).toHaveBeenCalledTimes(2);
    await act(async () => next.open());
    await settle();
    expect(rowIds()).toEqual([OCC4, OCC]);
    expect(screen.queryByText('Köhnə səhifə')).toBeNull();
  });

  it('shows a run once when it comes on two pages', async () => {
    mockRuns.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? runPage([run(OCC2), run(OCC3)]) : runPage([run(OCC), run(OCC2)], RUN_CURSOR)));
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await screen.findByTestId(`run-${OCC3}`);
    expect(rowIds()).toEqual([OCC, OCC2, OCC3]);
  });

  it('keeps the rows when a next page fails, does not ask again by itself, and retries that page', async () => {
    let fail = true;
    mockRuns.mockImplementation(async (q: { cursor?: string }) => {
      if (!q.cursor) return runPage([run(OCC), run(OCC2)], RUN_CURSOR);
      if (fail) {
        fail = false;
        throw ApiError.network();
      }
      return runPage([run(OCC3)]);
    });
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeTruthy();
    expect(rowIds()).toEqual([OCC, OCC2]);
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await settle();
    expect(cursorCalls()).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByTestId(`run-${OCC3}`)).toBeTruthy();
    expect(cursorCalls()).toBe(2);
    expect(mockRuns.mock.calls.filter(([q]) => !(q as { cursor?: string }).cursor)).toHaveLength(1); // the first page was not asked again
  });

  it('reloads stale data when the tab is focused again, and fresh data not', async () => {
    await opened();
    await act(async () => mockFocus.set(false));
    await act(async () => mockFocus.set(true));
    await settle();
    expect(mockSummary).toHaveBeenCalledTimes(1);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + TEAM_STALE_MS + 1_000);
    await act(async () => mockFocus.set(false));
    await act(async () => mockFocus.set(true));
    await waitFor(async () => expect(mockSummary).toHaveBeenCalledTimes(2));
    expect(mockEmployees).toHaveBeenCalledTimes(2);
    expect(mockRuns.mock.calls.filter(([q]) => !(q as { cursor?: string }).cursor)).toHaveLength(2);
  });
});

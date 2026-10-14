import { ApiError } from '@taskop/api-client';
import { formatDateTime } from '@taskop/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { checklist, OCC, T } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TeamRunScreen } from './run-screen';
import {
  EXECUTION,
  executionDetail,
  executionSummary,
  missedOccurrence,
  occurrenceDetail,
  PHOTO,
  PROBLEM,
  RUN_T,
  teamMe,
} from './testing/fixtures';
import { renderTeam } from './testing/render';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockOccurrence = jest.fn();
const mockExecution = jest.fn();
const mockUrl = jest.fn();
const mockRefreshMe = jest.fn();
const mockMe = teamMe();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: () => mockRefreshMe() },
  api: {
    occurrences: { get: (...a: unknown[]) => mockOccurrence(...a) },
    executions: { get: (...a: unknown[]) => mockExecution(...a) },
    media: { url: (...a: unknown[]) => mockUrl(...a) },
  },
}));

const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone: 'Asia/Baku' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function open(o: { online?: boolean } = {}) {
  const t = await createTestServices({ online: o.online ?? true });
  await renderTeam(t.services, <TeamRunScreen occurrenceId={OCC} />);
  return t;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));
  mockRefreshMe.mockResolvedValue(undefined);
});

describe('Team run screen', () => {
  it('shows an executed run: header, device and server times, score, flags, answers and problems', async () => {
    const c = checklist();
    mockOccurrence.mockResolvedValue(occurrenceDetail());
    mockExecution.mockResolvedValue(executionDetail(c));
    await open();
    expect(await screen.findByText('Açılış yoxlaması')).toBeTruthy();
    expect(screen.getByText('Bakı filialı 1')).toBeTruthy();
    expect(screen.getByLabelText('Tarix: 02.11.2026')).toBeTruthy();
    for (const badge of ['Tamamlanıb', 'Gecikib', 'Telefon saatı şübhəlidir']) expect(screen.getByText(badge)).toBeTruthy();
    expect(screen.getByLabelText('İcraçı: Aynur Quliyeva')).toBeTruthy();
    // The start reached the server at once: no receipt line. The completion synced hours later: both times.
    expect(screen.getByLabelText(`Başlayıb: ${at(T.open)}`)).toBeTruthy();
    expect(screen.getByLabelText(`Tamamlayıb: ${at(RUN_T.completed)}. Serverə çatıb: ${at(RUN_T.received)}`)).toBeTruthy();
    expect(screen.getByLabelText('Bal: 50%')).toBeTruthy();
    expect(await screen.findByTestId(`answer-${c.problem.id}`)).toBeTruthy();
    expect(screen.getByText('Cavablar')).toBeTruthy();
    expect(screen.getByTestId(`problem-${PROBLEM}`)).toBeTruthy();
    expect(mockOccurrence).toHaveBeenCalledWith(OCC);
    expect(mockExecution).toHaveBeenCalledWith(EXECUTION);
    await eventually(async () => expect(mockUrl).toHaveBeenCalledWith(PHOTO));
  });

  it('shows an unexecuted run with its assignees, and says it has not been done', async () => {
    mockOccurrence.mockResolvedValue(missedOccurrence());
    await open();
    expect(await screen.findByText('Hələ icra edilməyib')).toBeTruthy();
    for (const text of ['İcraçılar', 'Aynur Quliyeva', 'Kamran Əliyev', 'Buraxılıb']) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByLabelText(/^İcraçı:/)).toBeNull();
    await settle();
    expect(mockExecution).not.toHaveBeenCalled();
  });

  it('marks an unexecuted run nobody was assigned to', async () => {
    mockOccurrence.mockResolvedValue(missedOccurrence({ status: 'overdue', assignees: [], assigneeIds: [], unassigned: true }));
    await open();
    expect(await screen.findByText('Təyin edilməyib')).toBeTruthy();
    expect(screen.getByText('Gecikib')).toBeTruthy();
  });

  it('gives the reason of a cancelled run', async () => {
    mockOccurrence.mockResolvedValue(missedOccurrence({ status: 'cancelled', cancelReason: 'assignment_edited' }));
    await open();
    expect(await screen.findByLabelText('Ləğv səbəbi: Təyinat dəyişdirildi')).toBeTruthy();
    expect(screen.getByText('Ləğv edilib')).toBeTruthy();
  });

  it('says the score is not calculated when scoring is off', async () => {
    mockOccurrence.mockResolvedValue(occurrenceDetail({ execution: executionSummary({ scorePercent: null }) }));
    mockExecution.mockResolvedValue(executionDetail(checklist(), { scorePercent: null, score: null }));
    await open();
    expect(await screen.findByLabelText('Bal: Bal hesablanmır')).toBeTruthy();
  });

  it('shows no score or completion while the run is still being done', async () => {
    mockOccurrence.mockResolvedValue(
      occurrenceDetail({ status: 'in_progress', execution: executionSummary({ state: 'active', completedAt: null, completedReceivedAt: null, scorePercent: null, late: false, clockSuspect: false }) }),
    );
    mockExecution.mockResolvedValue(executionDetail(checklist(), { state: 'active', completedAt: null, completedReceivedAt: null }));
    await open();
    expect(await screen.findByText('Davam edir')).toBeTruthy();
    expect(screen.getByLabelText(`Başlayıb: ${at(T.open)}`)).toBeTruthy();
    expect(screen.queryByLabelText(/^Tamamlayıb:/)).toBeNull();
    expect(screen.queryByLabelText(/^Bal:/)).toBeNull();
  });

  it('offline it asks for a connection and loads nothing', async () => {
    await open({ online: false });
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    await settle();
    expect(mockOccurrence).not.toHaveBeenCalled();
  });

  it('says why a run cannot be opened, and tries again', async () => {
    mockOccurrence.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND')).mockResolvedValue(missedOccurrence());
    await open();
    expect(await screen.findByText('Məlumat tapılmadı.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('Hələ icra edilməyib')).toBeTruthy();
  });

  it('keeps the header when the answers fail to load, and retries them', async () => {
    const c = checklist();
    mockOccurrence.mockResolvedValue(occurrenceDetail());
    mockExecution.mockRejectedValueOnce(ApiError.network()).mockResolvedValue(executionDetail(c));
    await open();
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeTruthy();
    expect(screen.getByLabelText('İcraçı: Aynur Quliyeva')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByTestId(`answer-${c.problem.id}`)).toBeTruthy();
  });

  it('refreshes the profile when the server says 403', async () => {
    mockOccurrence.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN'));
    await open();
    expect(await screen.findByText('Bu əməliyyat üçün icazəniz yoxdur.')).toBeTruthy();
    await eventually(async () => expect(mockRefreshMe).toHaveBeenCalledTimes(1));
  });
});

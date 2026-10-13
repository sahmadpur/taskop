import type { TaskDetail } from '@taskop/contracts';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { ME_REF, syncTask, T, TASK } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ReviewScreen } from './review-screen';

const mockBack = jest.fn();
const mockGet = jest.fn();
const mockReview = jest.fn();
const mockUrl = jest.fn();
jest.mock('expo-router', () => ({ router: { back: (...a: unknown[]) => mockBack(...a), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
let mockPermissions: string[] = ['tasks.manage'];
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: mockPermissions } }),
  api: {
    tasks: { get: (...a: unknown[]) => mockGet(...a), review: (...a: unknown[]) => mockReview(...a) },
    taskMedia: { url: (...a: unknown[]) => mockUrl(...a) },
  },
}));

const SUB = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e95';
const PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e96';
const awaiting = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  ...syncTask({
    status: 'awaiting_review',
    requiresReview: true,
    media: [
      {
        id: PHOTO, role: 'response', submissionId: SUB, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, width: 1600, height: 1200,
        durationMs: null, capturedAt: T.open, capturedBy: ME_REF, status: 'uploaded', uploadedAt: T.open,
      },
    ],
    submissions: [
      {
        id: SUB, submittedBy: ME_REF, text: 'Rezin dəyişildi', mediaIds: [PHOTO], submittedAt: T.open, receivedAt: T.open,
        reviewDecision: null, reviewComment: null, reviewedBy: null, reviewedAt: null,
      },
    ],
  }),
  history: [],
  canManage: true,
  canReview: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['tasks.manage'];
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockUrl.mockResolvedValue({ url: `http://files.test/taskop-media/${PHOTO}.jpg?X-Amz-Signature=x`, expiresAt: T.due });
});

async function opened() {
  const t = await createTestServices({ online: true });
  await renderWithServices(t.services, <ReviewScreen taskId={TASK} />);
  return t;
}

describe('ReviewScreen', () => {
  it('shows the latest submission with its photo and approves it', async () => {
    mockGet.mockResolvedValue(awaiting());
    mockReview.mockResolvedValue(awaiting({ status: 'completed', canReview: false }));
    await opened();
    expect(await screen.findByText('Rezin dəyişildi')).toBeTruthy();
    expect(await screen.findByTestId(`remote-${PHOTO}`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Təsdiqlə' }));
    await eventually(async () => expect(mockBack).toHaveBeenCalled());
    expect(mockReview).toHaveBeenCalledWith(TASK, { decision: 'approve' });
    expect(Alert.alert).toHaveBeenCalledWith('Tapşırıq təsdiqləndi.');
  });

  it('needs a comment to send the task back', async () => {
    mockGet.mockResolvedValue(awaiting());
    mockReview.mockResolvedValue(awaiting({ status: 'in_progress', canReview: false }));
    await opened();
    await fireEvent.press(await screen.findByRole('button', { name: 'Geri qaytar' }));
    expect(await screen.findByText('Geri qaytarmaq üçün şərh yazın.')).toBeTruthy();
    expect(mockReview).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Şərh'), '  Foto bulanıqdır ');
    await fireEvent.press(screen.getByRole('button', { name: 'Geri qaytar' }));
    await eventually(async () => expect(mockReview).toHaveBeenCalledWith(TASK, { decision: 'reject', comment: 'Foto bulanıqdır' }));
  });

  it('says when the task no longer awaits review', async () => {
    mockGet.mockResolvedValue(awaiting({ status: 'completed', canReview: false }));
    await opened();
    expect(await screen.findByText('Bu tapşırıq artıq yoxlama gözləmir.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).toBeNull();
  });

  it('offline it says a connection is needed and loads nothing', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <ReviewScreen taskId={TASK} />);
    expect(await screen.findByText('İnternet bağlantısı tələb olunur')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shows no review UI and requests nothing without tasks.manage', async () => {
    mockPermissions = [];
    mockGet.mockResolvedValue(awaiting());
    await opened();
    expect(await screen.findByText('Bu əməliyyat üçün icazəniz yoxdur.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Geri qaytar' })).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('offers no decision when the server says the caller cannot review this task', async () => {
    mockGet.mockResolvedValue(awaiting({ canReview: false }));
    await opened();
    expect(await screen.findByText('Bu tapşırıq artıq yoxlama gözləmir.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Geri qaytar' })).toBeNull();
  });

  it('a double press reviews once, and the buttons stay disabled after success', async () => {
    mockGet.mockResolvedValue(awaiting());
    let resolve: (v: TaskDetail) => void = () => undefined;
    mockReview.mockReturnValue(new Promise<TaskDetail>((r) => (resolve = r)));
    await opened();
    const approve = await screen.findByRole('button', { name: 'Təsdiqlə' });
    await fireEvent.press(approve);
    await fireEvent.press(approve);
    await fireEvent.press(screen.getByRole('button', { name: 'Geri qaytar' }));
    expect(mockReview).toHaveBeenCalledTimes(1);
    await act(async () => resolve(awaiting({ status: 'completed', canReview: false })));
    await eventually(async () => expect(mockBack).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Təsdiqlə' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Geri qaytar' }));
    expect(mockReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Təsdiqlə' }).props.accessibilityState.disabled).toBe(true);
  });

  it('after a failed review the same decision can be sent again', async () => {
    mockGet.mockResolvedValue(awaiting());
    mockReview.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(awaiting({ status: 'completed', canReview: false }));
    await opened();
    await fireEvent.press(await screen.findByRole('button', { name: 'Təsdiqlə' }));
    await eventually(async () => expect(mockReview).toHaveBeenCalledTimes(1));
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Təsdiqlə' }));
    await eventually(async () => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockReview).toHaveBeenCalledTimes(2);
  });

  it('shows the top-level error when the server rejects a field the form does not draw', async () => {
    const { ApiError } = jest.requireActual<typeof import('@taskop/api-client')>('@taskop/api-client');
    mockGet.mockResolvedValue(awaiting());
    mockReview.mockRejectedValueOnce(new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { decision: 'errors.VALIDATION_FAILED' }));
    await opened();
    await fireEvent.press(await screen.findByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('Daxil edilən məlumatları yoxlayın.')).toBeTruthy();
  });
});

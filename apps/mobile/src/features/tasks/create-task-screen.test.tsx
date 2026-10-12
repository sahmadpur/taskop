import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { OTHER, SITE, syncTask, TEAM } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { CreateTaskScreen } from './create-task-screen';

const mockBack = jest.fn();
const mockCreate = jest.fn();
const mockAssignees = jest.fn();
let mockPermissions: string[] = ['tasks.manage'];
jest.mock('expo-router', () => ({ router: { back: (...a: unknown[]) => mockBack(...a), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
jest.mock('@/lib/session', () => ({
  // tasks.manage without sites.view: the site choices still come, from GET /tasks/assignees (decision 17).
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: mockPermissions } }),
  api: {
    tasks: { create: (...a: unknown[]) => mockCreate(...a), assignees: (...a: unknown[]) => mockAssignees(...a) },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['tasks.manage'];
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockAssignees.mockResolvedValue({
    users: [{ id: OTHER, fullName: 'Murad Həsənov', jobTitle: null, kind: 'worker' }],
    teams: [{ id: TEAM, name: 'Texniki xidmət', memberCount: 3 }],
    sites: [{ id: SITE, name: 'Bakı filialı 1' }],
  });
  mockCreate.mockImplementation(async (body: { id: string }) => ({ ...syncTask({ id: body.id }), history: [], canManage: true, canReview: true }));
});

describe('CreateTaskScreen', () => {
  it('offline it says a connection is needed and sends nothing', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <CreateTaskScreen />);
    expect(await screen.findByText('İnternet bağlantısı tələb olunur')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yarat' })).toBeNull();
    expect(mockAssignees).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('without tasks.manage it shows a not-allowed message, no form, and fetches nothing', async () => {
    mockPermissions = [];
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    expect(await screen.findByText('Bu əməliyyat üçün icazəniz yoxdur.')).toBeTruthy();
    expect(screen.queryByLabelText('Ad')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yarat' })).toBeNull();
    await new Promise((r) => setTimeout(r, 400));
    expect(mockAssignees).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a team task with a site, due date, review and photo evidence, then queues its instruction photo', async () => {
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ad'), '  Soyuducunu təmir et ');
    await fireEvent.changeText(screen.getByLabelText('Təlimat'), 'Rezini dəyişin');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Texniki xidmət (3 nəfər)' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Bakı filialı 1' }));
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD)'), '2026-11-03 18:00');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Yoxlama tələb olunur' }));
    await fireEvent.press(within(screen.getByTestId('evidence-photo')).getByRole('radio', { name: 'Mütləq' }));
    const { pickFromGallery } = jest.requireMock('@/features/execution/capture') as { pickFromGallery: jest.Mock };
    pickFromGallery.mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Foto: Qalereya' }));
    expect(await screen.findByTestId('instruction-0')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    await eventually(async () => expect(mockBack).toHaveBeenCalled());
    const body = mockCreate.mock.calls[0]![0] as { id: string };
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      title: 'Soyuducunu təmir et',
      instructions: 'Rezini dəyişin',
      priority: 'normal',
      siteId: SITE,
      dueAt: new Date('2026-11-03T18:00').toISOString(),
      evidence: { photo: 'required', video: 'optional', liveOnly: false },
      requiresReview: true,
      assignee: { teamId: TEAM },
    });
    expect(await t.db.all('SELECT owner_id, role FROM media')).toEqual([{ owner_id: body.id, role: 'instruction' }]);
    expect(Alert.alert).toHaveBeenCalledWith('Tapşırıq yaradıldı.');
  });

  it('asks for a title and an assignee before sending', async () => {
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await screen.findByRole('radio', { name: 'Murad Həsənov' });
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Ad yazın.')).toBeTruthy();
    expect(screen.getByText('İcraçı seçin.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("retries a failed create with the same client id and shows the server's field error", async () => {
    const { ApiError } = jest.requireActual<typeof import('@taskop/api-client')>('@taskop/api-client');
    mockCreate
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'errors.NETWORK'))
      .mockRejectedValueOnce(new ApiError(422, 'TASK_ASSIGNEE_INVALID', 'errors.TASK_ASSIGNEE_INVALID', { assignee: 'errors.TASK_ASSIGNEE_INVALID' }));
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ad'), 'Qapı');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Murad Həsənov' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Seçilmiş əməkdaş və ya komanda bu tapşırıq üçün uyğun deyil.')).toBeTruthy();
    expect(mockCreate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual([expect.any(String), (mockCreate.mock.calls[0]![0] as { id: string }).id]);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('a double press creates once and queues the instruction photo once', async () => {
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ad'), 'Qapı');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Murad Həsənov' }));
    const { pickFromGallery } = jest.requireMock('@/features/execution/capture') as { pickFromGallery: jest.Mock };
    pickFromGallery.mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Foto: Qalereya' }));
    await screen.findByTestId('instruction-0');
    const save = screen.getByRole('button', { name: 'Yarat' });
    await fireEvent.press(save);
    await fireEvent.press(save);
    await eventually(async () => expect(mockBack).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await t.db.all('SELECT id FROM media')).toHaveLength(1);
  });

  it('shows the top-level error when the server rejects a field the form does not draw', async () => {
    const { ApiError } = jest.requireActual<typeof import('@taskop/api-client')>('@taskop/api-client');
    mockCreate.mockRejectedValueOnce(new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { instructions: 'errors.VALIDATION_FAILED' }));
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ad'), 'Qapı');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Murad Həsənov' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Daxil edilən məlumatları yoxlayın.')).toBeTruthy();
  });
});

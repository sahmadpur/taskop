import type { ProblemDto, SyncTask } from '@taskop/contracts';
import { fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { CHECKLIST, ME_REF, OCC, OTHER, SITE, syncResponse, syncTask, T, TASK, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { TaskScreen } from './task-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockUrl = jest.fn();
const mockProblemUrl = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    taskMedia: { url: (...a: unknown[]) => mockUrl(...a) },
    tasks: { problemMediaUrl: (...a: unknown[]) => mockProblemUrl(...a) },
  },
}));

const PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e90';
const PROBLEM_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e91';
const PROBLEM_VIDEO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e95';

async function opened(over: Partial<SyncTask> = {}, o: { online?: boolean } = {}): Promise<TestServices> {
  const t = await createTestServices({ online: o.online });
  await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask(over)] }));
  await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
  await screen.findByText(over.title ?? 'Soyuducunun qapısını təmir et');
  return t;
}
const gallery = () => (jest.requireMock('@/features/execution/capture') as { pickFromGallery: jest.Mock }).pickFromGallery;

beforeEach(() => jest.clearAllMocks());

describe('TaskScreen', () => {
  it('offers Qəbul et and Başla on a new task; Başla accepts and starts it', async () => {
    const t = await opened();
    expect(screen.getByText('Qapının rezinini dəyişin.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Qəbul et' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Başla' }));
    await eventually(async () => expect((await t.services.tasks.task(TASK))!.status).toBe('in_progress'));
    expect(await screen.findByLabelText('Cavab')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Qəbul et' })).toBeNull();
  });

  it('keeps Tamamla disabled with the reason until the required photo is attached, then completes', async () => {
    const t = await opened({ status: 'in_progress' });
    expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Ən azı bir foto əlavə edin.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Cavab'), 'Rezin dəyişildi');
    await fireEvent(screen.getByLabelText('Cavab'), 'blur');
    gallery().mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Foto: Qalereya' }));
    await eventually(async () => expect(screen.queryByText('Ən azı bir foto əlavə edin.')).toBeNull());
    await eventually(async () => expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    expect(await screen.findByText('Cavab göndərildi.')).toBeTruthy();
    const task = (await t.services.tasks.task(TASK))!;
    expect(task.status).toBe('completed');
    expect(task.draft).toMatchObject({ text: 'Rezin dəyişildi', mediaIds: [expect.any(String)] });
  });

  it('offers only the camera on a live-only task and no chip for a kind it does not take', async () => {
    await opened({ status: 'in_progress', evidence: { photo: 'required', video: 'none', liveOnly: true } });
    expect(screen.getByRole('button', { name: 'Foto: Kamera' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Foto: Qalereya' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Video:/ })).toBeNull();
  });

  it('shows the reviewer’s comment after a rejection, and the problem the task fixes with its photo when online', async () => {
    mockProblemUrl.mockResolvedValue({ url: `http://files.test/taskop-media/${PROBLEM_PHOTO}?X-Amz-Signature=x`, expiresAt: T.due });
    const problem: ProblemDto = {
      id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e92', executionId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e50', occurrenceId: OCC, localDate: '2026-11-02',
      siteId: SITE, siteName: 'Bakı filialı 1', checklistId: CHECKLIST, checklistName: 'Açılış yoxlaması', itemId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e93',
      itemLabel: 'Soyuducuda problem varmı?', source: 'manual', severity: 'critical', note: 'Qapı bağlanmır', mediaIds: [PROBLEM_PHOTO, PROBLEM_VIDEO],
      media: [
        { id: PROBLEM_PHOTO, kind: 'photo', status: 'uploaded' },
        { id: PROBLEM_VIDEO, kind: 'video', status: 'pending' },
      ],
      executorName: 'Aysel Əliyeva', createdAt: T.open, resolution: 'open', taskId: TASK, executionState: 'completed',
    };
    await opened(
      {
        status: 'in_progress', source: 'problem', problemId: problem.id, problem,
        submissions: [
          {
            id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e94', submittedBy: ME_REF, text: 'Hazırdır', mediaIds: [],
            submittedAt: T.open, receivedAt: T.open, reviewDecision: 'rejected', reviewComment: 'Foto bulanıqdır', reviewedBy: null, reviewedAt: T.open,
          },
        ],
      },
      { online: true },
    );
    expect(screen.getByText('Geri qaytarıldı: Foto bulanıqdır')).toBeTruthy();
    expect(screen.getByText('Açılış yoxlaması · Bakı filialı 1')).toBeTruthy();
    expect(screen.getByText('Qapı bağlanmır')).toBeTruthy();
    // The kind comes from ProblemDto.media, not from the URL; the pending video is drawn but never signed.
    expect(await screen.findByTestId(`remote-${PROBLEM_PHOTO}`)).toBeTruthy();
    expect(screen.getByTestId(`pending-${PROBLEM_VIDEO}`)).toBeTruthy();
    expect(screen.getByLabelText('Video hələ yüklənməyib')).toBeTruthy();
    expect(mockProblemUrl.mock.calls).toEqual([[TASK, PROBLEM_PHOTO]]);
  });

  it('shows instruction photos only when online', async () => {
    const instruction = {
      id: PHOTO, role: 'instruction' as const, submissionId: null, kind: 'photo' as const, source: 'camera' as const, mime: 'image/jpeg', bytes: 10,
      width: 1600, height: 1200, durationMs: null, capturedAt: T.open, capturedBy: { id: OTHER, fullName: 'Murad Həsənov' }, status: 'uploaded' as const, uploadedAt: T.open,
    };
    await opened({ media: [instruction] });
    expect(screen.getByText('Fayllar internet olanda görünəcək.')).toBeTruthy();
    expect(mockUrl).not.toHaveBeenCalled();
  });

  it('keeps a draft the server refused read-only with the note, and lets the worker discard a photo that failed to upload', async () => {
    const t = await createTestServices();
    await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask({ status: 'in_progress' })] }));
    const id = await t.services.tasks.attachMedia(TASK, capturedPhoto(t.transport));
    await t.services.tasks.saveText(TASK, 'Rezin dəyişildi');
    await t.db.run(`DELETE FROM outbox`);
    await t.db.run(`UPDATE media SET registered_at = ?, failed_code = 'UPLOAD_FAILED', attempts = 5`, [T.open]);
    await t.db.run(`UPDATE tasks SET local_status = 'cancelled', sync_note = 'errors.TASK_STATE_INVALID'`);
    await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
    expect(await screen.findByText('Server qəbul etmədi: Tapşırığın vəziyyəti dəyişib; bu əməliyyat artıq mümkün deyil.')).toBeTruthy();
    expect(screen.getByText('Bu cavab göndərilə bilmədi və artıq dəyişdirilə bilməz.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tamamla' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sil: Foto' }));
    await eventually(async () => expect((await t.services.tasks.task(TASK))!.draft!.mediaIds).not.toContain(id));
  });

  it('saves the text typed just before Tamamla, without waiting for the debounce or a blur', async () => {
    const t = await createTestServices();
    await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask({ status: 'in_progress' })] }));
    await t.services.tasks.attachMedia(TASK, capturedPhoto(t.transport));
    await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
    await screen.findByText('Soyuducunun qapısını təmir et');
    await fireEvent.changeText(screen.getByLabelText('Cavab'), 'Son söz');
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    expect(await screen.findByText('Cavab göndərildi.')).toBeTruthy();
    expect((await t.services.tasks.task(TASK))!.draft!.text).toBe('Son söz');
    const submit = await t.db.first<{ payload: string }>(`SELECT payload FROM outbox WHERE kind = 'task.submit'`);
    expect(JSON.parse(submit!.payload)).toMatchObject({ text: 'Son söz' });
  });

  it('ignores a save that arrives after the draft stopped being editable, without an alert', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const t = await opened({ status: 'in_progress' });
    await fireEvent.changeText(screen.getByLabelText('Cavab'), 'Gec qalan söz');
    await t.db.run(`UPDATE tasks SET local_status = 'cancelled'`);
    await fireEvent(screen.getByLabelText('Cavab'), 'blur');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alert).not.toHaveBeenCalled();
    expect((await t.services.tasks.task(TASK))!.draft).toBeNull();
    alert.mockRestore();
  });

  it('shows a placeholder for a response photo whose file was already cleaned up', async () => {
    const t = await createTestServices();
    await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask({ status: 'in_progress' })] }));
    await t.services.tasks.attachMedia(TASK, capturedPhoto(t.transport));
    await t.db.run(`UPDATE media SET registered_at = ?, uploaded_at = ?, file_deleted_at = ?`, [T.open, T.open, T.open]);
    await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
    expect(await screen.findByText('Yükləndi')).toBeTruthy();
    expect(screen.getByText('Cavab')).toBeTruthy();
  });

  it('does not submit when the flushed text could not be saved, and retries the save on the next Tamamla', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const t = await createTestServices();
    await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask({ status: 'in_progress' })] }));
    await t.services.tasks.attachMedia(TASK, capturedPhoto(t.transport));
    await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
    await screen.findByText('Soyuducunun qapısını təmir et');
    const save = jest.spyOn(t.services.tasks, 'saveText').mockRejectedValueOnce(new Error('disk'));
    await fireEvent.changeText(screen.getByLabelText('Cavab'), 'Yeni mətn');
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    expect(await t.db.first(`SELECT 1 FROM outbox WHERE kind = 'task.submit'`)).toBeNull();
    expect((await t.services.tasks.task(TASK))!.status).toBe('in_progress');
    await eventually(async () => expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    expect(await screen.findByText('Cavab göndərildi.')).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(2);
    const submit = await t.db.first<{ payload: string }>(`SELECT payload FROM outbox WHERE kind = 'task.submit'`);
    expect(JSON.parse(submit!.payload)).toMatchObject({ text: 'Yeni mətn' });
    alert.mockRestore();
  });
});

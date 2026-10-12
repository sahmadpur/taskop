import { ApiError } from '@taskop/api-client';
import type { TaskDetail } from '@taskop/contracts';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { assigneeOptions, AT, MANAGER, problemDto, submissionDto, taskDetail, taskMediaDto } from './fixtures';
import { TaskDrawer } from './task-drawer';

const mocks = vi.hoisted(() => ({
  api: {
    tasks: { get: vi.fn(), review: vi.fn(), cancel: vi.fn(), update: vi.fn(), assignees: vi.fn(), problemMediaUrl: vi.fn(), registerMedia: vi.fn() },
    taskMedia: { url: vi.fn(), confirmUploaded: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => ({ user: { id: 'mgr' }, permissions: ['tasks.view', 'tasks.manage'], tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const signed = { url: 'http://files.test/taskop-media/t/a/k/t1/m.jpg?sig=1', expiresAt: '2026-11-02T04:25:00.000Z' };

/** A problem task in review: one instruction photo, a rejected first answer, a second one with a pending photo. */
const inReview = (): TaskDetail =>
  taskDetail({
    status: 'awaiting_review',
    source: 'problem',
    problemId: 'p1',
    requiresReview: true,
    priority: 'high',
    instructions: 'Rezini dəyişin.',
    overdueAt: '2026-11-03T14:00:00.000Z',
    evidence: { photo: 'required', video: 'none', liveOnly: true },
    media: [
      taskMediaDto({ id: 'im1', role: 'instruction', capturedBy: MANAGER }),
      taskMediaDto({ id: 'rm1', submissionId: 's1' }),
      taskMediaDto({ id: 'rm2', submissionId: 's2', status: 'pending', uploadedAt: null }),
    ],
    submissions: [
      submissionDto({
        id: 's1',
        text: 'Hazırdır',
        mediaIds: ['rm1'],
        reviewDecision: 'rejected',
        reviewComment: 'Foto bulanıqdır',
        reviewedBy: MANAGER,
        reviewedAt: '2026-11-02T06:00:00.000Z',
      }),
      submissionDto({ id: 's2', text: 'Yenidən çəkdim', mediaIds: ['rm2'], submittedAt: '2026-11-02T07:00:00.000Z' }),
    ],
    problem: problemDto({ resolution: 'open', taskId: 't1' }),
    history: [
      { id: 'h1', fromStatus: null, toStatus: 'new', at: AT, actor: MANAGER, comment: null },
      { id: 'h2', fromStatus: 'accepted', toStatus: 'new', at: AT, actor: null, comment: 'assignee_deactivated' },
      { id: 'h3', fromStatus: 'awaiting_review', toStatus: 'in_progress', at: AT, actor: MANAGER, comment: 'Foto bulanıqdır' },
    ],
  });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.taskMedia.url.mockResolvedValue(signed);
  mocks.api.tasks.assignees.mockResolvedValue(assigneeOptions());
});

describe('TaskDrawer', () => {
  it('shows details, instructions with media, submissions in order with their reviews, history and the problem', async () => {
    mocks.api.tasks.get.mockResolvedValue(inReview());
    const router = renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />, '/tasks?task=t1');
    const drawer = await screen.findByRole('dialog', { name: 'Soyuducunun qapısını təmir edin' });
    expect(mocks.api.tasks.get).toHaveBeenCalledWith('t1');
    for (const text of ['Yoxlamada', 'Gecikib', 'Yüksək', 'Nigar Səfərli', 'Anbar №1', 'Tələb olunur', 'Foto: Mütləq · Video: Lazım deyil · yalnız kamera', 'Leyla Quliyeva yaradıb']) {
      expect(drawer).toHaveTextContent(text);
    }
    const instructions = within(drawer).getByRole('region', { name: 'Təlimat' });
    expect(instructions).toHaveTextContent('Rezini dəyişin.');
    expect(within(instructions).getByRole('button', { name: 'Bax: Foto' })).toBeInTheDocument();
    const first = within(drawer).getByRole('listitem', { name: 'Cavab 1' });
    for (const text of ['Hazırdır', 'Geri qaytarılıb', 'Yoxlayanın şərhi: Foto bulanıqdır', 'Leyla Quliyeva']) expect(first).toHaveTextContent(text);
    const second = within(drawer).getByRole('listitem', { name: 'Cavab 2' });
    expect(second).toHaveTextContent('Yenidən çəkdim');
    expect(within(second).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
    const history = within(drawer).getByRole('region', { name: 'Tarixçə' });
    expect(history).toHaveTextContent('Qəbul edilib → Yeni · Sistem · İcraçı deaktiv edildi; tapşırıq komandaya qaytarıldı');
    expect(history).toHaveTextContent('Yoxlamada → İcradadır · Leyla Quliyeva · Foto bulanıqdır');
    const problem = within(drawer).getByRole('region', { name: 'Mənbə problem' });
    for (const text of ['Kritik', 'Temperatur', 'Açılış', 'Kondisioner xarabdır', 'Aysel']) expect(problem).toHaveTextContent(text);
    await userEvent.click(within(problem).getByRole('link', { name: 'İcraya bax' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
  });

  it('approves, and rejects only with a comment', async () => {
    mocks.api.tasks.get.mockResolvedValue(inReview());
    mocks.api.tasks.review.mockResolvedValue(taskDetail({ status: 'in_progress' }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    const reject = await screen.findByRole('button', { name: 'Geri qaytar' });
    expect(reject).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Geri qaytarma səbəbi'), '   ');
    expect(reject).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Geri qaytarma səbəbi'), 'Foto bulanıqdır');
    await userEvent.click(reject);
    await waitFor(() => expect(mocks.api.tasks.review).toHaveBeenCalledWith('t1', { decision: 'reject', comment: 'Foto bulanıqdır' }));
    // The answer replaces the drawer's copy at once: no review actions on a task in progress.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toHaveTextContent('İcradadır');
    cleanup();
    mocks.api.tasks.review.mockResolvedValue(taskDetail({ status: 'completed' }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() => expect(mocks.api.tasks.review).toHaveBeenLastCalledWith('t1', { decision: 'approve' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Tamamlanıb'));
  });

  it('cancels with a reason, and opens the edit dialog', async () => {
    mocks.api.tasks.get.mockResolvedValue(taskDetail({ status: 'accepted' }));
    mocks.api.tasks.cancel.mockResolvedValue(taskDetail({ status: 'cancelled', cancelReason: 'Lazım deyil', cancelledAt: AT }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Redaktə et' }));
    expect(await screen.findByRole('dialog', { name: 'Tapşırığı redaktə et' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ləğv et' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tapşırığı redaktə et' })).not.toBeInTheDocument());
    const cancel = screen.getByRole('button', { name: 'Tapşırığı ləğv et' });
    expect(cancel).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Ləğv səbəbi'), ' Lazım deyil ');
    await userEvent.click(cancel);
    await waitFor(() => expect(mocks.api.tasks.cancel).toHaveBeenCalledWith('t1', { reason: 'Lazım deyil' }));
    expect(await screen.findByText('Ləğv səbəbi: Lazım deyil')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redaktə et' })).not.toBeInTheDocument();
  });

  it('offers only the actions the caller may take, and warns about an inactive assignee', async () => {
    mocks.api.tasks.get.mockResolvedValue(taskDetail({ status: 'awaiting_review', canManage: false, canReview: false, assigneeInactive: true }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    expect(await screen.findByText('İcraçı deaktiv edilib. Tapşırığı başqasına təyin edin.')).toBeInTheDocument();
    for (const name of ['Təsdiqlə', 'Geri qaytar', 'Redaktə et', 'Tapşırığı ləğv et']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    cleanup();
    // The creator without tasks.manage may still review (spec §6.1).
    mocks.api.tasks.get.mockResolvedValue(taskDetail({ status: 'awaiting_review', canManage: false, canReview: true }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Təsdiqlə' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redaktə et' })).not.toBeInTheDocument();
  });

  it('shows the error and the current task when someone changed it meanwhile', async () => {
    mocks.api.tasks.get.mockResolvedValueOnce(inReview()).mockResolvedValue(taskDetail({ status: 'completed' }));
    mocks.api.tasks.review.mockRejectedValue(new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID'));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('Tapşırığın vəziyyəti dəyişib; bu əməliyyat artıq mümkün deyil.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).not.toBeInTheDocument());
    expect(mocks.api.tasks.get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog')).toHaveTextContent('Tamamlanıb');
  });

  it('sends one command for a same-tick double press, also across Approve and Reject', async () => {
    mocks.api.tasks.get.mockResolvedValue(inReview());
    mocks.api.tasks.review.mockResolvedValue(taskDetail({ status: 'completed' }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    const approve = await screen.findByRole('button', { name: 'Təsdiqlə' });
    await userEvent.type(screen.getByLabelText('Geri qaytarma səbəbi'), 'Foto bulanıqdır');
    const reject = screen.getByRole('button', { name: 'Geri qaytar' });
    // All presses land before React renders the disabled buttons.
    act(() => {
      approve.click();
      approve.click();
      reject.click();
    });
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Tamamlanıb'));
    expect(mocks.api.tasks.review).toHaveBeenCalledTimes(1);
    expect(mocks.api.tasks.review).toHaveBeenCalledWith('t1', { decision: 'approve' });
  });

  it('sends one reject and one cancel for a same-tick double press', async () => {
    mocks.api.tasks.get.mockResolvedValue(inReview());
    mocks.api.tasks.review.mockResolvedValue(taskDetail({ status: 'in_progress' }));
    mocks.api.tasks.cancel.mockResolvedValue(taskDetail({ status: 'cancelled', cancelReason: 'Lazım deyil' }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Təsdiqlə' });
    await userEvent.type(screen.getByLabelText('Geri qaytarma səbəbi'), 'Foto bulanıqdır');
    await userEvent.type(screen.getByLabelText('Ləğv səbəbi'), 'Lazım deyil');
    const reject = screen.getByRole('button', { name: 'Geri qaytar' });
    act(() => {
      reject.click();
      reject.click();
    });
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('İcradadır'));
    expect(mocks.api.tasks.review).toHaveBeenCalledTimes(1);
    cleanup();
    mocks.api.tasks.get.mockResolvedValue(taskDetail({ status: 'accepted' }));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText('Ləğv səbəbi'), 'Lazım deyil');
    const cancel = screen.getByRole('button', { name: 'Tapşırığı ləğv et' });
    act(() => {
      cancel.click();
      cancel.click();
    });
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Ləğv edilib'));
    expect(mocks.api.tasks.cancel).toHaveBeenCalledTimes(1);
  });

  it('shows the closed state, not a crash, when the refetch after a refused command answers 404', async () => {
    mocks.api.tasks.get.mockResolvedValueOnce(inReview()).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    mocks.api.tasks.review.mockRejectedValue(new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID'));
    renderWithRouter(<TaskDrawer id="t1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('Məlumat tapılmadı.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tarixçə' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bağla' })).toBeInTheDocument();
  });

  it('shows the not-found text when the task cannot be read at all', async () => {
    mocks.api.tasks.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    const onClose = vi.fn();
    renderWithRouter(<TaskDrawer id="t1" onClose={onClose} />);
    expect(await screen.findByText('Məlumat tapılmadı.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Tapşırıq' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));
    expect(onClose).toHaveBeenCalled();
  });
});

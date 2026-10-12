import { ApiError } from '@taskop/api-client';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { assigneeOptions, problemDto, taskDetail, taskMediaDto } from './fixtures';
import { TaskDialog } from './task-dialog';

const mocks = vi.hoisted(() => ({
  tz: { current: 'Asia/Baku' },
  api: {
    tasks: { assignees: vi.fn(), create: vi.fn(), update: vi.fn(), registerMedia: vi.fn() },
    taskMedia: { confirmUploaded: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => ({ user: { id: 'mgr' }, permissions: ['tasks.view', 'tasks.manage'], tenant: { timezone: mocks.tz.current, locale: 'az' } }),
}));

const readMeta = async () => ({ width: 1600, height: 1200, durationMs: null });
const ticket = (id: string) => ({ mediaId: id, status: 'pending', uploadUrl: `http://files.test/${id}`, headers: { 'Content-Type': 'image/jpeg' }, expiresAt: null });

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocks.tz.current = 'Asia/Baku';
  // Its `sites` are the dialog's site choices (Part 1 decision 25): only Anbar №1.
  mocks.api.tasks.assignees.mockResolvedValue(assigneeOptions());
  mocks.api.tasks.create.mockImplementation(async (body: { id: string }) => taskDetail({ id: body.id }));
  mocks.api.tasks.update.mockImplementation(async (id: string) => taskDetail({ id }));
  mocks.api.tasks.registerMedia.mockImplementation(async (_task: string, body: { id: string }) => ticket(body.id));
  mocks.api.taskMedia.confirmUploaded.mockResolvedValue({ status: 'uploaded' });
});

function renderDialog(props: Partial<ComponentProps<typeof TaskDialog>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<TaskDialog onClose={onClose} onSaved={onSaved} readMeta={readMeta} {...props} />);
  return { onClose, onSaved };
}

async function pickAssignee(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'İcraçı' }));
  await userEvent.click(await screen.findByRole('option', { name }));
}

async function fillMinimum() {
  await userEvent.type(screen.getByLabelText('Başlıq'), 'Qapı');
  await pickAssignee('Nigar Səfərli');
}

const photo = () => new File([new Uint8Array(10)], 'qapi.jpg', { type: 'image/jpeg' });

describe('TaskDialog', () => {
  it("creates a task with every field, the due time read in the tenant's zone", async () => {
    mocks.tz.current = 'Europe/Berlin';
    const { onClose, onSaved } = renderDialog();
    expect(screen.getByRole('dialog', { name: 'Yeni tapşırıq' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Başlıq'), '  Soyuducunun qapısını təmir edin ');
    await userEvent.type(screen.getByLabelText('Təlimat'), 'Rezini dəyişin');
    await userEvent.selectOptions(screen.getByLabelText('Prioritet'), 'high');
    await pickAssignee('Nigar Səfərli');
    await within(screen.getByLabelText('Obyekt')).findByRole('option', { name: 'Anbar №1' });
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), 'site1');
    fireEvent.change(screen.getByLabelText('Son tarix'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('Saat'), { target: { value: '09:00' } });
    expect(screen.getByText(/Europe\/Berlin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tamamlandıqdan sonra yoxlama tələb olunur' }));
    await userEvent.selectOptions(screen.getByLabelText('Foto'), 'required');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Yalnız kamera ilə çəkilmiş (qalereyadan yox)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.api.tasks.create).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/),
      title: 'Soyuducunun qapısını təmir edin',
      instructions: 'Rezini dəyişin',
      priority: 'high',
      siteId: 'site1',
      // 09:00 in Berlin on 2 November (CET, +1), whatever the browser's zone.
      dueAt: '2026-11-02T08:00:00.000Z',
      evidence: { photo: 'required', video: 'optional', liveOnly: true },
      requiresReview: true,
      assignee: { userId: 'w1' },
      problemId: null,
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: mocks.api.tasks.create.mock.calls[0]![0].id }));
  });

  it('checks the title, the assignee and a time without a date before sending', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Saat'), { target: { value: '09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    expect(screen.getAllByText('Bu xana mütləqdir.')).toHaveLength(2);
    expect(screen.getByText('Saat üçün tarix seçin.')).toBeInTheDocument();
    expect(mocks.api.tasks.create).not.toHaveBeenCalled();
  });

  it('assigns a team, and shows the API refusal of an assignee on the field', async () => {
    mocks.api.tasks.create.mockRejectedValue(
      new ApiError(422, 'TASK_ASSIGNEE_INVALID', 'errors.TASK_ASSIGNEE_INVALID', { assignee: 'errors.TASK_ASSIGNEE_INVALID' }),
    );
    renderDialog();
    await userEvent.type(screen.getByLabelText('Başlıq'), 'Qapı');
    await pickAssignee('Texniki xidmət');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() =>
      expect(mocks.api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({ assignee: { teamId: 'team1' }, requiresReview: false, dueAt: null, siteId: null })),
    );
    expect(await screen.findAllByText('Seçilmiş əməkdaş və ya komanda bu tapşırıq üçün uyğun deyil.')).toHaveLength(2);
  });

  it('pre-fills from a problem: item, note, high priority for critical, review on, the site of the problem', async () => {
    const { onClose } = renderDialog({ problem: problemDto() });
    expect(screen.getByRole('dialog', { name: 'Problemdən tapşırıq' })).toBeInTheDocument();
    expect(screen.getByLabelText('Başlıq')).toHaveValue('Temperatur');
    expect(screen.getByLabelText('Təlimat')).toHaveValue('Kondisioner xarabdır');
    expect(screen.getByLabelText('Prioritet')).toHaveValue('high');
    expect(screen.getByRole('checkbox', { name: 'Tamamlandıqdan sonra yoxlama tələb olunur' })).toBeChecked();
    expect(screen.getByText('Obyekt problemdən götürülür: Anbar №1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Obyekt')).not.toBeInTheDocument();
    // No site list for a problem task: nothing is asked for until the picker opens.
    expect(mocks.api.tasks.assignees).not.toHaveBeenCalled();
    await pickAssignee('Nigar Səfərli');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.api.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ problemId: 'p1', siteId: null, title: 'Temperatur', instructions: 'Kondisioner xarabdır', priority: 'high', requiresReview: true }),
    );
  });

  it('uploads instruction files after creating the task: register, PUT, confirm', async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', put);
    const { onClose } = renderDialog();
    await fillMinimum();
    const file = photo();
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), file);
    const files = await screen.findByRole('list', { name: 'Seçilmiş fayllar' });
    expect(files).toHaveTextContent('qapi.jpg');
    expect(files).toHaveTextContent('Gözləyir');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const taskId = mocks.api.tasks.create.mock.calls[0]![0].id;
    const mediaId = mocks.api.tasks.registerMedia.mock.calls[0]![1].id;
    expect(mocks.api.tasks.registerMedia).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({ role: 'instruction', kind: 'photo', source: 'gallery', mime: 'image/jpeg', bytes: 10, width: 1600, height: 1200 }),
    );
    expect(put).toHaveBeenCalledWith(`http://files.test/${mediaId}`, expect.objectContaining({ method: 'PUT', body: file }));
    expect(mocks.api.taskMedia.confirmUploaded).toHaveBeenCalledWith(mediaId);
    // The task exists before any of its files is registered.
    expect(mocks.api.tasks.create.mock.invocationCallOrder[0]!).toBeLessThan(mocks.api.tasks.registerMedia.mock.invocationCallOrder[0]!);
  });

  it('keeps the created task when an upload fails, and retries only that file with the same id', async () => {
    const put = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', put);
    const { onClose, onSaved } = renderDialog();
    await fillMinimum();
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), photo());
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Tapşırıq yadda saxlanıldı, amma 1 fayl yüklənmədi. Yenidən cəhd edin və ya pəncərəni bağlayın.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Seçilmiş fayllar' })).toHaveTextContent('Yüklənmədi');
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Faylları yenidən yüklə' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.api.tasks.create).toHaveBeenCalledTimes(1);
    const [first, second] = mocks.api.tasks.registerMedia.mock.calls;
    expect(second![1].id).toBe(first![1].id);
    expect(mocks.api.taskMedia.confirmUploaded).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('closing after a failed upload still hands over the created task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { onClose, onSaved } = renderDialog();
    await fillMinimum();
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), photo());
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await screen.findByRole('button', { name: 'Faylları yenidən yüklə' });
    await userEvent.click(screen.getByRole('button', { name: 'Ləğv et' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: mocks.api.tasks.create.mock.calls[0]![0].id }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers the sites from GET /tasks/assignees, and keeps an edited task's current site selectable", async () => {
    renderDialog({ task: taskDetail({ site: { id: 'old', name: 'Köhnə anbar' } }) });
    const select = screen.getByLabelText('Obyekt');
    await within(select).findByRole('option', { name: 'Anbar №1' });
    expect(within(select).getByRole('option', { name: 'Köhnə anbar' })).toBeInTheDocument();
    expect(select).toHaveValue('old');
    expect(mocks.api.tasks.assignees).toHaveBeenCalledWith({});
  });

  it('sends only what changed: a new title does not reassign; a new assignee does, with a warning', async () => {
    const task = taskDetail({ title: 'Qapı', status: 'in_progress' });
    const first = renderDialog({ task });
    expect(screen.getByRole('dialog', { name: 'Tapşırığı redaktə et' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'İcraçı' })).toHaveValue('Nigar Səfərli');
    expect(screen.getByLabelText('Son tarix')).toHaveValue('2026-11-03');
    expect(screen.getByLabelText('Saat')).toHaveValue('18:00');
    await userEvent.clear(screen.getByLabelText('Başlıq'));
    await userEvent.type(screen.getByLabelText('Başlıq'), 'Qapını təmir edin');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(first.onClose).toHaveBeenCalled());
    expect(mocks.api.tasks.update).toHaveBeenCalledWith('t1', { title: 'Qapını təmir edin' });
    cleanup();
    renderDialog({ task });
    await pickAssignee('Texniki xidmət');
    expect(screen.getByText('İcraçı dəyişəndə tapşırıq yenidən "Yeni" statusuna keçir.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.tasks.update).toHaveBeenLastCalledWith('t1', { assignee: { teamId: 'team1' } }));
  });

  it('sends one create and one upload for a same-tick double press, and stays off after success', async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', put);
    const { onClose } = renderDialog();
    await fillMinimum();
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), photo());
    await screen.findByRole('list', { name: 'Seçilmiş fayllar' });
    const save = screen.getByRole('button', { name: 'Yarat' });
    // Both presses land before React renders the disabled button.
    act(() => {
      save.click();
      save.click();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(mocks.api.tasks.create).toHaveBeenCalledTimes(1);
    expect(mocks.api.tasks.registerMedia).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stamps the files no later than the created task's own time, whatever the computer's clock", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    mocks.api.tasks.create.mockImplementation(async (body: { id: string }) => taskDetail({ id: body.id, createdAt: '2020-01-01T00:00:00.000Z' }));
    const { onClose } = renderDialog();
    await fillMinimum();
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), photo());
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.api.tasks.registerMedia.mock.calls[0]![1].capturedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('after an edit, stamps the files with the PATCH answer\'s updatedAt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    mocks.api.tasks.update.mockImplementation(async (id: string) => taskDetail({ id, updatedAt: '2020-02-02T00:00:00.000Z' }));
    const { onClose } = renderDialog({ task: taskDetail() });
    await userEvent.type(screen.getByLabelText('Başlıq'), ' 2');
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), photo());
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.api.tasks.registerMedia.mock.calls[0]![1].capturedAt).toBe('2020-02-02T00:00:00.000Z');
  });

  it('counts every registered instruction file of the task, pending ones too, and the files already queued', async () => {
    const media = [
      taskMediaDto({ id: 'm1', role: 'instruction', status: 'uploaded' }),
      taskMediaDto({ id: 'm2', role: 'instruction', status: 'pending' }),
      taskMediaDto({ id: 'm3', role: 'instruction', status: 'pending' }),
      taskMediaDto({ id: 'm4', role: 'response' }),
    ];
    renderDialog({ task: taskDetail({ media }) });
    // Three of five instruction slots are taken (the response photo is not one): two fit, the third is refused.
    await userEvent.upload(screen.getByLabelText('Təlimat faylları'), [photo(), photo(), photo()]);
    const files = await screen.findByRole('list', { name: 'Seçilmiş fayllar' });
    expect(within(files).getAllByText('Gözləyir')).toHaveLength(2);
    expect(within(files).getAllByText('Qəbul edilmədi')).toHaveLength(1);
    expect(files).toHaveTextContent('Ən çox 5 təlimat faylı əlavə etmək olar.');
    expect(screen.getByLabelText('Təlimat faylları')).toBeDisabled();
  });
});

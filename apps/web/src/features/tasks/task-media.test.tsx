import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { taskMediaDto } from './fixtures';
import { ProblemMediaStrip, TaskMediaStrip } from './task-media';

const mocks = vi.hoisted(() => ({ api: { media: { url: vi.fn() }, taskMedia: { url: vi.fn() }, tasks: { problemMediaUrl: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const signed = (path: string) => ({ url: `http://files.test/taskop-media/${path}?sig=1`, expiresAt: '2026-11-02T04:25:00.000Z' });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
});

describe('task media', () => {
  it('signs task media through the task media endpoint and never asks for a pending one', async () => {
    mocks.api.taskMedia.url.mockResolvedValue(signed('t/a/k/t1/tm1.jpg'));
    renderWithProviders(<TaskMediaStrip media={[taskMediaDto({ id: 'tm1' }), taskMediaDto({ id: 'tm2', status: 'pending', uploadedAt: null })]} />);
    expect(screen.getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }));
    const lightbox = await screen.findByRole('dialog', { name: 'Foto' });
    expect(await within(lightbox).findByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/taskop-media/t/a/k/t1/tm1.jpg?sig=1');
    expect(lightbox).toHaveTextContent('Nigar Səfərli');
    // The thumbnail and the lightbox share one cached URL.
    expect(mocks.api.taskMedia.url).toHaveBeenCalledTimes(1);
    expect(mocks.api.taskMedia.url).toHaveBeenCalledWith('tm1');
    expect(mocks.api.media.url).not.toHaveBeenCalled();
  });

  it("signs a problem's uploaded media through the task, with the kind and status the problem gives", async () => {
    mocks.api.tasks.problemMediaUrl.mockImplementation(async (_task: string, id: string) => signed(`t/a/e/x1/${id}`));
    renderWithProviders(
      <ProblemMediaStrip
        taskId="t1"
        media={[
          { id: 'pm1', kind: 'photo', status: 'uploaded' },
          { id: 'pv1', kind: 'video', status: 'uploaded' },
          { id: 'pp1', kind: 'photo', status: 'pending' },
        ]}
      />,
    );
    // The kind comes from ProblemDto.media; the URL has no extension to read.
    expect(screen.getByRole('button', { name: 'Bax: Video' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }));
    const lightbox = await screen.findByRole('dialog', { name: 'Foto' });
    expect(await within(lightbox).findByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/taskop-media/t/a/e/x1/pm1?sig=1');
    // Only the uploaded photo is signed (thumbnail and lightbox share it); the video waits for a click, the pending photo is never signed.
    expect(mocks.api.tasks.problemMediaUrl.mock.calls).toEqual([['t1', 'pm1']]);
    expect(mocks.api.media.url).not.toHaveBeenCalled();
  });

  it('says so when an uploaded problem medium cannot be signed', async () => {
    mocks.api.tasks.problemMediaUrl.mockRejectedValue(new Error('MEDIA_NOT_FOUND_IN_STORAGE'));
    renderWithProviders(<ProblemMediaStrip taskId="t1" media={[{ id: 'pm1', kind: 'photo', status: 'uploaded' }]} />);
    expect(await screen.findByText('Fayl açılmadı')).toBeInTheDocument();
  });

  it('signs a new URL when the task media URL expired while its lightbox was open', async () => {
    mocks.api.taskMedia.url.mockResolvedValueOnce(signed('t/a/k/t1/tm1.jpg')).mockResolvedValueOnce({ ...signed('t/a/k/t1/tm1.jpg'), url: 'http://files.test/tm1?sig=2' });
    renderWithProviders(<TaskMediaStrip media={[taskMediaDto({ id: 'tm1' })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }));
    const lightbox = await screen.findByRole('dialog', { name: 'Foto' });
    fireEvent.error(await within(lightbox).findByRole('img', { name: 'Foto' }));
    await waitFor(() => expect(within(lightbox).getByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/tm1?sig=2'));
    expect(mocks.api.taskMedia.url).toHaveBeenCalledTimes(2);
  });

  it('asks for a new URL when a problem lightbox is opened after the cached one is close to expiring', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      mocks.api.tasks.problemMediaUrl.mockResolvedValueOnce({ ...signed('x'), url: 'http://files.test/pm1?sig=1' }).mockResolvedValueOnce({ ...signed('x'), url: 'http://files.test/pm1?sig=2' });
      renderWithProviders(<ProblemMediaStrip taskId="t1" media={[{ id: 'pm1', kind: 'photo', status: 'uploaded' }]} />);
      await waitFor(() => expect(mocks.api.tasks.problemMediaUrl).toHaveBeenCalledTimes(1));
      // Inside the freshness window the open lightbox reuses the thumbnail's URL.
      await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }), { delay: null });
      expect(await within(await screen.findByRole('dialog', { name: 'Foto' })).findByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/pm1?sig=1');
      expect(mocks.api.tasks.problemMediaUrl).toHaveBeenCalledTimes(1);
      await userEvent.keyboard('{Escape}', { delay: null });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // The page stayed open for 5 minutes: opening it again must not use the expired URL.
      act(() => {
        vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      });
      await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }), { delay: null });
      const lightbox = await screen.findByRole('dialog', { name: 'Foto' });
      await waitFor(() => expect(within(lightbox).getByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/pm1?sig=2'));
      expect(mocks.api.tasks.problemMediaUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

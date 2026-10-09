import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { mediaDto } from './fixtures';
import { MediaLightbox, MediaThumb } from './media';

const mocks = vi.hoisted(() => ({ api: { media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const signed = (id: string, n: number) => ({ url: `http://files.test/${id}?sig=${n}`, expiresAt: '2026-11-02T04:25:00.000Z' });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
});

describe('media', () => {
  it('shows pending media as not uploaded and never asks for its URL', async () => {
    renderWithProviders(<MediaThumb media={mediaDto({ id: 'm2', status: 'pending', uploadedAt: null })} onOpen={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Foto hələ yüklənməyib' })).toHaveTextContent('Yüklənməyib');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.api.media.url).not.toHaveBeenCalled();
  });

  it('opens an uploaded photo from its thumbnail, and a video without loading it first', async () => {
    mocks.api.media.url.mockResolvedValue(signed('m1', 1));
    const onOpen = vi.fn();
    const photo = mediaDto({ id: 'm1' });
    const video = mediaDto({ id: 'v1', kind: 'video', mime: 'video/mp4', durationMs: 12_000 });
    renderWithProviders(
      <>
        <MediaThumb media={photo} onOpen={onOpen} />
        <MediaThumb media={video} onOpen={onOpen} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }));
    expect(onOpen).toHaveBeenCalledWith(photo);
    expect(screen.getByRole('button', { name: 'Bax: Video' })).toHaveTextContent('12 san');
    await waitFor(() => expect(mocks.api.media.url).toHaveBeenCalledTimes(1));
    expect(mocks.api.media.url).toHaveBeenCalledWith('m1');
  });

  it('fetches a fresh URL once when the photo fails after its URL expired', async () => {
    mocks.api.media.url.mockResolvedValueOnce(signed('m1', 1)).mockResolvedValueOnce(signed('m1', 2));
    renderWithProviders(<MediaLightbox media={mediaDto({ id: 'm1' })} onClose={vi.fn()} />);
    const lightbox = await screen.findByRole('dialog', { name: 'Foto' });
    expect(await within(lightbox).findByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/m1?sig=1');
    // The browser reloads the image after the 5-minute URL expired: storage answers 403.
    fireEvent.error(within(lightbox).getByRole('img', { name: 'Foto' }));
    await waitFor(() => expect(within(lightbox).getByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/m1?sig=2'));
    expect(mocks.api.media.url).toHaveBeenCalledTimes(2);
    // A second failure in a row is shown instead of looping.
    fireEvent.error(within(lightbox).getByRole('img', { name: 'Foto' }));
    expect(await within(lightbox).findByText('Fayl açılmadı')).toBeInTheDocument();
    expect(mocks.api.media.url).toHaveBeenCalledTimes(2);
  });

  it('fetches a fresh URL for a video that fails mid-play', async () => {
    mocks.api.media.url.mockResolvedValueOnce(signed('v1', 1)).mockResolvedValueOnce(signed('v1', 2));
    renderWithProviders(<MediaLightbox media={mediaDto({ id: 'v1', kind: 'video', mime: 'video/mp4', durationMs: 12_000 })} onClose={vi.fn()} />);
    const lightbox = await screen.findByRole('dialog', { name: 'Video' });
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1?sig=1'));
    fireEvent.error(within(lightbox).getByLabelText('Video'));
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1?sig=2'));
    expect(within(lightbox).getByText(/Aysel Məmmədova/)).toBeInTheDocument();
  });

  it('resumes a video at the same position after its URL was refreshed', async () => {
    mocks.api.media.url.mockResolvedValueOnce(signed('v1', 1)).mockResolvedValueOnce(signed('v1', 2));
    renderWithProviders(<MediaLightbox media={mediaDto({ id: 'v1', kind: 'video', mime: 'video/mp4', durationMs: 12_000 })} onClose={vi.fn()} />);
    const lightbox = await screen.findByRole('dialog', { name: 'Video' });
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1?sig=1'));
    const first = within(lightbox).getByLabelText('Video') as HTMLVideoElement;
    first.currentTime = 7.5;
    fireEvent.error(first);
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1?sig=2'));
    // The new element starts at 0; once its metadata is known the player jumps back to where it stopped.
    const second = within(lightbox).getByLabelText('Video') as HTMLVideoElement;
    expect(second.currentTime).toBe(0);
    fireEvent.loadedMetadata(second);
    expect(second.currentTime).toBe(7.5);
  });
});

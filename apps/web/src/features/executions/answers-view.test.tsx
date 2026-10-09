import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AnswersView } from './answers-view';
import { executionFixture } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('AnswersView', () => {
  it('renders answers in the pinned layout with indented follow-ups and highlighted problems', () => {
    const f = executionFixture();
    renderWithProviders(<AnswersView content={f.content} answers={f.answers} media={f.media} problems={f.problems} />);
    const zal = screen.getByRole('region', { name: 'Zal' });
    expect(within(zal).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual([
      'Problem varmı?',
      'Təsvir edin',
      'Temperatur',
      'Ümumi görünüş',
    ]);
    const question = within(zal).getByRole('listitem', { name: 'Problem varmı?' });
    expect(question).toHaveTextContent('Bəli');
    expect(question).toHaveAttribute('data-problem', 'critical');
    expect(within(question).getByText('Kritik')).toBeInTheDocument();
    const followUp = within(zal).getByRole('listitem', { name: 'Təsvir edin' });
    expect(followUp).toHaveAttribute('data-depth', '1');
    expect(followUp).toHaveTextContent('Su axır');
    expect(followUp).not.toHaveAttribute('data-problem');
    const temp = within(zal).getByRole('listitem', { name: 'Temperatur' });
    expect(temp).toHaveTextContent('10 °C');
    expect(temp).toHaveTextContent('Qeyd: isti');
    expect(temp).toHaveTextContent('Kondisioner xarabdır');
    expect(within(temp).getByText('Qayda üzrə')).toBeInTheDocument();
    expect(within(temp).getByText('Əl ilə qeyd')).toBeInTheDocument();
    expect(within(temp).getByText('Adi')).toBeInTheDocument();
    expect(temp).toHaveAttribute('data-problem', 'critical');
    expect(within(temp).getByRole('button', { name: 'Bax: Foto' })).toBeInTheDocument();
    const son = screen.getByRole('region', { name: 'Son' });
    expect(within(son).getByRole('listitem', { name: 'Qeyd' })).toHaveTextContent('Cavab verilməyib');
  });

  it('does not show answers to follow-ups that the final answers hide', () => {
    const f = executionFixture();
    // The worker answered the follow-up, then changed "yes" to "no": the stored document still holds it.
    const answers = { [f.problem.id]: { optionIds: [f.no.id] }, [f.comment.id]: { text: 'köhnə mətn' } };
    renderWithProviders(<AnswersView content={f.content} answers={answers} media={[]} problems={[]} />);
    expect(screen.getByRole('listitem', { name: 'Problem varmı?' })).toHaveTextContent('Xeyr');
    expect(screen.queryByRole('listitem', { name: 'Təsvir edin' })).not.toBeInTheDocument();
    expect(screen.queryByText('köhnə mətn')).not.toBeInTheDocument();
  });

  it('asks for URLs of uploaded photos only, marks pending ones and plays a video in the lightbox', async () => {
    const f = executionFixture();
    renderWithProviders(<AnswersView content={f.content} answers={f.answers} media={f.media} problems={f.problems} />);
    const photoItem = screen.getByRole('listitem', { name: 'Ümumi görünüş' });
    expect(within(photoItem).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
    expect(within(photoItem).getAllByRole('button', { name: 'Bax: Foto' })).toHaveLength(1);
    await waitFor(() => expect(mocks.api.media.url).toHaveBeenCalledTimes(2));
    expect(mocks.api.media.url.mock.calls.map(([id]) => id).sort()).toEqual(['m1', 'pm1']);
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Video' }));
    const lightbox = await screen.findByRole('dialog', { name: 'Video' });
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1'));
    expect(mocks.api.media.url).not.toHaveBeenCalledWith('m2');
  });

  it('shows a manual problem\'s media that are also the item\'s evidence only once', async () => {
    const f = executionFixture();
    // The manual problem on the photo item attaches the item's own photo m1 and an extra photo pm1.
    const problems = [{ id: 'pr9', itemId: f.photo.id, source: 'manual' as const, severity: 'normal' as const, note: 'Sınıq', mediaIds: ['m1', 'pm1'], createdAt: '2026-11-02T04:20:00.000Z' }];
    renderWithProviders(<AnswersView content={f.content} answers={f.answers} media={f.media} problems={problems} />);
    const photoItem = screen.getByRole('listitem', { name: 'Ümumi görünüş' });
    // m1 (evidence) once + pm1 (problem-only) once; the pending m2 is an img, not a button.
    expect(within(photoItem).getAllByRole('button', { name: 'Bax: Foto' })).toHaveLength(2);
    await waitFor(() => expect(mocks.api.media.url).toHaveBeenCalledTimes(2));
    expect(mocks.api.media.url.mock.calls.map(([id]) => id).sort()).toEqual(['m1', 'pm1']);
  });

  it('says so when the execution has no answers', () => {
    const f = executionFixture();
    renderWithProviders(<AnswersView content={f.content} answers={{}} media={[]} problems={[]} />);
    expect(screen.getByText('Bu icrada cavab yoxdur.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});

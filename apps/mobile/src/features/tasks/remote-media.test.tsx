import { act, fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { RemoteMediaStrip, type RemoteMedia, URL_REFRESH_MARGIN_MS } from './remote-media';

jest.mock('@/features/execution/capture', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { VideoPreview: ({ uri }: { uri: string }) => <MockText testID="player">{uri}</MockText> };
});

const A = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea1';
const B = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea2';
const V = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea3';
const photo = (id: string): RemoteMedia => ({ id, kind: 'photo', status: 'uploaded' });
const video: RemoteMedia = { id: V, kind: 'video', status: 'uploaded' };
const FAILED = 'Fayllar açıla bilmədi.';

const signed = (t: TestServices, id: string, n: number, ttlMs = 5 * 60_000) => ({
  url: `http://files.test/${id}?sig=${n}`,
  expiresAt: new Date(t.clock.now() + ttlMs).toISOString(),
});

async function show(t: TestServices, items: RemoteMedia[], load: (id: string) => Promise<ReturnType<typeof signed>>) {
  await t.seed();
  await renderWithServices(t.services, <RemoteMediaStrip items={items} load={load} />);
}
const setOnline = async (t: TestServices, online: boolean) => {
  t.net.online = online;
  await act(async () => t.services.engine.refresh());
};

describe('RemoteMediaStrip', () => {
  it('shows the media that signed when one fails, and marks the failed one', async () => {
    const t = await createTestServices({ online: true });
    const load = jest.fn(async (id: string) => {
      if (id === B) throw new Error('boom');
      return signed(t, id, 1);
    });
    await show(t, [photo(A), photo(B)], load);
    expect(await screen.findByTestId(`remote-${A}`)).toBeTruthy();
    expect(await screen.findByTestId(`failed-${B}`)).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
  });

  it('signs everything again when the phone comes back online after a failure', async () => {
    const t = await createTestServices({ online: true });
    let broken = true;
    const load = jest.fn(async (id: string) => {
      if (broken) throw new Error('boom');
      return signed(t, id, 2);
    });
    await show(t, [photo(A)], load);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    await setOnline(t, false);
    broken = false;
    await setOnline(t, true);
    expect(await screen.findByTestId(`remote-${A}`)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('signs a video again before playing it when its URL is about to expire', async () => {
    const t = await createTestServices({ online: true });
    let n = 0;
    const load = jest.fn(async (id: string) => signed(t, id, ++n, 60_000));
    await show(t, [video], load);
    await screen.findByTestId(`remote-${V}`);
    // Plenty of time left: plays the URL it has.
    await fireEvent.press(screen.getByRole('button', { name: 'Video 1' }));
    expect((await screen.findByTestId('player')).props.children).toBe(`http://files.test/${V}?sig=1`);
    expect(load).toHaveBeenCalledTimes(1);
    t.clock.advance(60_000 - URL_REFRESH_MARGIN_MS + 1_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Video 1' }));
    await eventually(async () => expect(load).toHaveBeenCalledTimes(2));
    await eventually(async () => expect(screen.getByTestId('player').props.children).toBe(`http://files.test/${V}?sig=2`));
  });

  it('signs a photo again once when it fails to load', async () => {
    const t = await createTestServices({ online: true });
    let n = 0;
    const load = jest.fn(async (id: string) => signed(t, id, ++n));
    await show(t, [photo(A)], load);
    const image = await screen.findByTestId(`remote-${A}`);
    expect(image.props.source).toEqual({ uri: `http://files.test/${A}?sig=1` });
    await fireEvent(image, 'error');
    await eventually(async () => expect(screen.getByTestId(`remote-${A}`).props.source).toEqual({ uri: `http://files.test/${A}?sig=2` }));
    // The new URL failing too does not loop.
    await fireEvent(screen.getByTestId(`remote-${A}`), 'error');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

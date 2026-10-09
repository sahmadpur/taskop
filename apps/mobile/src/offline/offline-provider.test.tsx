import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Text } from 'react-native';
import { useOffline } from './context';
import { OfflineProvider } from './offline-provider';

const mockEvents: string[] = [];
const mockFailures = new Set<string>();

// The real queue with fake services: each step takes a few ms, so an overlap would show in the event order.
jest.mock('./native/create-native-services', () => {
  const { createSessionQueue } = jest.requireActual<typeof import('./session-queue')>('./session-queue');
  const queue = createSessionQueue();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
  return {
    openNativeServices: (userId: string) =>
      queue.open(async () => {
        mockEvents.push(`create ${userId} start`);
        await pause();
        if (mockFailures.delete(userId)) {
          mockEvents.push(`create ${userId} failed`);
          throw new Error('cannot open');
        }
        mockEvents.push(`create ${userId} end`);
        return {
          value: { userId },
          dispose: async () => {
            mockEvents.push(`dispose ${userId} start`);
            await pause();
            mockEvents.push(`dispose ${userId} end`);
          },
        };
      }),
  };
});

function Who() {
  return <Text>user {useOffline().userId}</Text>;
}

const ui = (userId: string) => (
  <OfflineProvider userId={userId} timeZone="Asia/Baku">
    <Who />
  </OfflineProvider>
);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

beforeEach(() => {
  mockEvents.length = 0;
  mockFailures.clear();
});

describe('OfflineProvider', () => {
  it("fully disposes the previous user's services before creating the next user's", async () => {
    const view = await render(ui('A'));
    expect(await screen.findByText('user A')).toBeTruthy();
    await view.rerender(ui('B'));
    expect(await screen.findByText('user B')).toBeTruthy();
    await view.unmount();
    await settle();
    expect(mockEvents).toEqual([
      'create A start',
      'create A end',
      'dispose A start',
      'dispose A end',
      'create B start',
      'create B end',
      'dispose B start',
      'dispose B end',
    ]);
  });

  it('a remount before the services are ready never overlaps two creations (StrictMode)', async () => {
    const view = await render(<StrictMode>{ui('A')}</StrictMode>);
    await view.rerender(<StrictMode>{ui('B')}</StrictMode>);
    expect(await screen.findByText('user B')).toBeTruthy();
    await view.unmount();
    await settle();
    // Every creation is followed by its own disposal before the next creation starts.
    const pairs = mockEvents.join('|');
    expect(pairs).toMatch(/^(create (\w) start\|create \2 end\|dispose \2 start\|dispose \2 end\|?)+$/);
    expect(mockEvents.at(-4)).toBe('create B start');
  });

  it('shows the failure with a retry button that opens the store again', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFailures.add('A');
    const view = await render(ui('A'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('user A')).toBeTruthy();
    expect(error).toHaveBeenCalledWith('[offline] Could not open the local database', expect.any(Error));
    await view.unmount();
    await settle();
    error.mockRestore();
  });
});

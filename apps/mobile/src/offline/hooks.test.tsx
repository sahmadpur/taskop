import { act, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useLiveQuery } from './hooks';
import { renderWithServices } from './testing/render';
import { createTestServices } from './testing/test-services';

describe('useLiveQuery', () => {
  it('logs a failed run, keeps the last value and recovers on the next change', async () => {
    const t = await createTestServices();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let runs = 0;
    function Count() {
      const n = useLiveQuery(async () => {
        runs++;
        if (runs === 2) throw new Error('disk I/O error');
        return runs;
      }, []);
      return <Text>runs {String(n)}</Text>;
    }
    await renderWithServices(t.services, <Count />);
    expect(await screen.findByText('runs 1')).toBeTruthy();
    await act(async () => t.services.feed.emit());
    expect(screen.getByText('runs 1')).toBeTruthy();
    expect(error).toHaveBeenCalledWith('[offline] A local query failed', expect.any(Error));
    await act(async () => t.services.feed.emit());
    expect(await screen.findByText('runs 3')).toBeTruthy();
    error.mockRestore();
    await t.services.dispose();
  });
});

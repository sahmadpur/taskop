import { settleWithin } from './settle-within';

describe('settleWithin', () => {
  afterEach(() => jest.useRealTimers());

  it('reports a promise that settles in time, and one that fails', async () => {
    expect(await settleWithin(Promise.resolve(1), 1_000)).toBe('done');
    expect(await settleWithin(Promise.reject(new Error('x')), 1_000)).toBe('failed');
  });

  it('gives up on a promise that never settles', async () => {
    jest.useFakeTimers();
    let result: string | null = null;
    void settleWithin(new Promise(() => undefined), 3_000).then((r) => (result = r));
    await jest.advanceTimersByTimeAsync(2_999);
    expect(result).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(result).toBe('timeout');
  });
});

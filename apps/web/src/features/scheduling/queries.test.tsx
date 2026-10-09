import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOccurrences } from './queries';

const mocks = vi.hoisted(() => ({ api: { occurrences: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => vi.resetAllMocks());

describe('useOccurrences', () => {
  it('follows nextCursor until the range is complete', async () => {
    mocks.api.occurrences.list
      .mockResolvedValueOnce({ items: [{ id: 'o1' }], nextCursor: 'o1' })
      .mockResolvedValueOnce({ items: [{ id: 'o2' }], nextCursor: null });
    const { result } = renderHook(() => useOccurrences({ from: '2026-11-02', to: '2026-11-08' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'o1' }, { id: 'o2' }]));
    expect(mocks.api.occurrences.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'o1', limit: 200 }));
  });
});

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { taskKeys } from '@/features/tasks/queries';
import { refreshRunViews } from './queries';

vi.mock('@/lib/session', () => ({ api: {} }));

describe('refreshRunViews', () => {
  it('invalidates the run views and the task views', async () => {
    const qc = new QueryClient();
    const keys = [['executions', 'detail', 'x1'], ['problems', 'list', {}], ['reports', 'runs', {}], taskKeys.list({} as never), taskKeys.detail('t1'), ['checklists', 'options']];
    for (const key of keys) qc.setQueryData(key, { cached: true });
    await refreshRunViews(qc);
    const invalidated = (key: readonly unknown[]) => qc.getQueryState(key)!.isInvalidated;
    expect(keys.map(invalidated)).toEqual([true, true, true, true, true, false]);
  });
});

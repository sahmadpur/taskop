import { ApiError } from '@taskop/api-client';
import { blankContent, type ChecklistContent } from '@taskop/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './use-autosave';

const c = (title: string): ChecklistContent => ({ ...blankContent(), instructions: title });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces changes into one save with the latest content', async () => {
    const save = vi.fn(async (_c: ChecklistContent, revision: number) => ({ revision: revision + 1, issues: [] }));
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 3, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    expect(result.current.status).toBe('saved');
    rerender({ content: c('ab'), version: 1 });
    rerender({ content: c('abc'), version: 2 });
    expect(result.current.status).toBe('dirty');
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'abc' }), 3);
    expect(result.current.status).toBe('saved');
    expect(result.current.revision()).toBe(4);
  });

  it('flush saves newer edits made during an in-flight save', async () => {
    const first = deferred<{ revision: number; issues: [] }>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 3, issues: [] });
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    let done: Promise<boolean>;
    act(() => {
      done = result.current.flush();
    });
    rerender({ content: c('c'), version: 2 });
    const again = result.current.flush();
    await act(async () => first.resolve({ revision: 2, issues: [] }));
    await expect(done!).resolves.toBe(true);
    await expect(again).resolves.toBe(true);
    expect(save.mock.calls.map((call) => [call[0].instructions, call[1]])).toEqual([['b', 1], ['c', 2]]);
    expect(result.current.revision()).toBe(3);
  });

  it('stops on a conflict and reports errors', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(409, 'CHECKLIST_DRAFT_CONFLICT', 'x', null, null, null, null, 9));
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.status).toBe('conflict');
    rerender({ content: c('c'), version: 2 });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(save).toHaveBeenCalledTimes(1);
    await expect(result.current.flush()).resolves.toBe(false);
  });

  it('marks network errors and retries on the next change', async () => {
    const save = vi.fn().mockRejectedValueOnce(ApiError.network()).mockResolvedValueOnce({ revision: 2, issues: [] });
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.status).toBe('error');
    rerender({ content: c('bc'), version: 2 });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.status).toBe('saved');
  });

  it('never saves without a save function (read-only)', async () => {
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1 }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('saved');
  });

  it('flushes when the page is hidden', async () => {
    const save = vi.fn(async () => ({ revision: 2, issues: [] }));
    const { rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

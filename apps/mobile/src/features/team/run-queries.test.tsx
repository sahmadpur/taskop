import { ApiError } from '@taskop/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { checklist, ME } from '@/offline/testing/fixtures';
import { teamKeys, useRunCommand, useTeamAudit, useTeamCorrections } from './queries';
import { AUDIT, auditDetail, EXECUTION, executionCorrections, VIEWER2 } from './testing/fixtures';
import { gate, testQueryClient } from './testing/render';

const mockAudit = jest.fn();
const mockHistory = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    audits: { get: (...a: unknown[]) => mockAudit(...a) },
    corrections: { history: (...a: unknown[]) => mockHistory(...a) },
  },
  session: { refreshMe: jest.fn() },
}));

async function hook<R>(fn: () => R, client: QueryClient = testQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...(await renderHook(fn, { wrapper })), client };
}

beforeEach(() => jest.clearAllMocks());

describe('run commands (Global Constraints: one at a time, then refresh)', () => {
  it('runs one action at a time: a second tap while the first is in flight does nothing', async () => {
    const { result } = await hook(() => useRunCommand(ME));
    const g = gate();
    const job = jest.fn(async () => {
      await g.opened;
      return 'done';
    });
    let first: Promise<unknown> = Promise.resolve();
    let second: unknown = 'not run';
    await act(async () => {
      first = result.current.run(job);
      second = await result.current.run(job);
    });
    expect(second).toBeNull();
    expect(result.current.busy).toBe(true);
    await act(async () => {
      g.open();
      expect(await first).toEqual({ ok: true, value: 'done' });
    });
    expect(job).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('refreshes every team query of the viewer after a success, and keeps a failure to show', async () => {
    const client = testQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await hook(() => useRunCommand(ME), client);
    await act(async () => {
      await result.current.run(async () => 1);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['team', ME] });
    invalidate.mockClear();
    const error = new ApiError(409, 'EXECUTION_LOCKED', 'errors.EXECUTION_LOCKED');
    let failed: unknown;
    await act(async () => {
      failed = await result.current.run(async () => {
        throw error;
      });
    });
    expect(failed).toEqual({ ok: false, error });
    expect(result.current.error).toBe(error);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.run(async () => 2, { refresh: false });
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('refreshes the viewer’s queries after a refusal only when refreshOnError says the screen is stale', async () => {
    const client = testQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await hook(() => useRunCommand(ME), client);
    const refuse = (code: 'ANSWERS_CONFLICT' | 'EXECUTION_LOCKED') => async () => {
      throw new ApiError(409, code, `errors.${code}`);
    };
    const stale = (e: ApiError) => e.code === 'EXECUTION_LOCKED';
    await act(async () => {
      await result.current.run(refuse('ANSWERS_CONFLICT'), { refreshOnError: stale });
    });
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.run(refuse('EXECUTION_LOCKED'), { refreshOnError: stale });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['team', ME] });
  });
});

describe('audit and corrections queries', () => {
  it('loads an audit and a run’s corrections under the viewer’s keys', async () => {
    const c = checklist();
    mockAudit.mockResolvedValue(auditDetail(c));
    mockHistory.mockResolvedValue(executionCorrections());
    const { result, client } = await hook(() => ({ audit: useTeamAudit(ME, AUDIT, true), history: useTeamCorrections(ME, EXECUTION, true) }));
    await waitFor(() => expect(result.current.audit.data?.id).toBe(AUDIT));
    await waitFor(() => expect(result.current.history.data).toEqual(executionCorrections()));
    expect(mockAudit).toHaveBeenCalledWith(AUDIT);
    expect(mockHistory).toHaveBeenCalledWith(EXECUTION);
    expect(client.getQueryData(teamKeys.audit(ME, AUDIT))).toBeTruthy();
    expect(client.getQueryData(teamKeys.audit(VIEWER2, AUDIT))).toBeUndefined();
  });

  it('asks for nothing while disabled or without an execution', async () => {
    await hook(() => ({ audit: useTeamAudit(ME, AUDIT, false), history: useTeamCorrections(ME, null, true) }));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
  });
});

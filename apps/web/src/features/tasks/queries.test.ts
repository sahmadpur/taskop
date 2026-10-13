import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { taskDetail } from './fixtures';
import { storeTask, taskKeys } from './queries';

vi.mock('@/lib/session', () => ({ api: {} }));

describe('storeTask', () => {
  it("is not overwritten by a refetch that was already on its way (it answers with the task before the command)", async () => {
    const qc = new QueryClient();
    let answerOld: (t: ReturnType<typeof taskDetail>) => void = () => {};
    const inFlight = qc.fetchQuery({ queryKey: taskKeys.detail('t1'), queryFn: () => new Promise((resolve) => (answerOld = resolve)) });
    inFlight.catch(() => {});
    await storeTask(qc, taskDetail({ status: 'in_progress' }));
    answerOld(taskDetail({ status: 'awaiting_review' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(qc.getQueryData<{ status: string }>(taskKeys.detail('t1'))?.status).toBe('in_progress');
  });
});

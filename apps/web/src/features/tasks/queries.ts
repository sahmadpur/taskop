import { ApiError } from '@taskop/api-client';
import type { TaskDetail, TaskListQuery } from '@taskop/contracts';
import { keepPreviousData, type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const taskKeys = {
  lists: ['tasks', 'list'] as const,
  list: (q: TaskListQuery) => ['tasks', 'list', q] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  assignees: (q: string) => ['tasks', 'assignees', q] as const,
};

/** Newest first, 50 per page; the page asks for more with "Daha çox göstər". */
export const useTasks = (query: TaskListQuery, enabled = true) =>
  useInfiniteQuery({
    queryKey: taskKeys.list(query),
    queryFn: ({ pageParam }) => api.tasks.list({ ...query, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

/** A 404 (gone, or no longer readable for the caller after a command) is final: no retry, the drawer shows it. */
export const useTask = (id: string) =>
  useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => api.tasks.get(id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

/**
 * GET /tasks/assignees (tasks.manage only): the picker's people and teams for `q`, and the sites a task may name
 * (the same for every `q`; the dialog reads them from the `''` entry). Asked only while enabled.
 */
export const useTaskAssignees = (q: string, enabled: boolean) =>
  useQuery({ queryKey: taskKeys.assignees(q), queryFn: () => api.tasks.assignees(q ? { q } : {}), enabled, staleTime: 60_000, placeholderData: keepPreviousData });

/**
 * After a command: the drawer shows the answer at once, task lists refetch, and for a problem task the problems
 * page and the execution tab refetch too (the problem's resolution may have changed).
 */
export async function storeTask(qc: QueryClient, task: TaskDetail): Promise<void> {
  qc.setQueryData(taskKeys.detail(task.id), task);
  await Promise.all([
    qc.invalidateQueries({ queryKey: taskKeys.lists }),
    ...(task.problemId ? [qc.invalidateQueries({ queryKey: ['problems'] }), qc.invalidateQueries({ queryKey: ['executions'] })] : []),
  ]);
}
